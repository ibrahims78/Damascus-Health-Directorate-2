import { Router } from "express";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import {
  db,
  nodeIdentityTable,
  syncOutboxTable,
  syncConflictTable,
  syncCursorTable,
  syncInboxTable,
} from "@workspace/db";
import { getCurrentWarehouse } from "../lib/warehouse-service";
import { logger } from "../lib/logger";
import { auditLog } from "../middlewares/audit";
import { requireAuth, requireRole } from "../middlewares/auth";
import {
  ensureNodeSigningKeys,
  exchangeSigningPayload,
  getTrustedPublicKey,
  packageSigningPayload,
  signPackageBuffer,
  signPayload,
  upsertTrustedPublicKey,
  verifyPayload,
} from "../lib/sync-signing";
import {
  acknowledgeSyncPackage,
  applyIncomingChanges,
  applySyncPackage,
  createSyncSession,
  currentVector,
  getSyncNode,
  getSyncPackage,
  getSyncSession,
  handshakeSyncSession,
  prepareOutgoingChanges,
  prepareSyncPackage,
} from "../lib/sync-service";
import {
  consumePairing,
  createPairing,
  getRelayPackage,
  listRelayPackages,
  listTrustedNodes,
  purgeExpiredRelayPackages,
  revokeTrustedNode,
  uploadRelayPackage,
} from "../lib/relay-service";
import { listSyncConflicts, resolveSyncConflict } from "../lib/conflict-service";
import {
  applyRestore,
  createDeltaBackup,
  createFullBackup,
  decodePackage,
  packageSummary,
} from "../lib/backup-service";
import { usersTable } from "@workspace/db";

const router = Router();

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "تعذر تنفيذ عملية المزامنة";
}

// POST /api/sync/exchange is dual-mode: the orchestrator runs under a normal
// admin session, while the peer side authenticates with Basic credentials and
// must stay reachable without a session cookie. Every other sync route keeps
// requiring an admin session.
router.use((req, res, next) => {
  if (
    (req.path === "/exchange" && req.method === "POST") ||
    (req.path === "/node" && req.method === "GET")
  ) {
    // Populate res.locals.user from the session when present; otherwise let
    // the route decide (peer mode validates Basic auth itself).
    if (req.session?.userId) return requireAuth(req, res, next);
    return next();
  }
  return requireAuth(req, res, next);
});
router.use((req, res, next) => {
  if (
    (req.path === "/exchange" && req.method === "POST") ||
    (req.path === "/node" && req.method === "GET")
  ) {
    return next();
  }
  return requireRole("admin")(req, res, next);
});

// GET /api/sync/node — stable identity and the node's current vector.
router.get("/node", async (req, res) => {
  try {
    // Session admin (web UI) or Basic-auth peer (orchestrator pre-flight).
    if (!res.locals.user) {
      const credentials = await credentialsFromRequest(req);
      if (!credentials) {
        res.status(401).json({ error: "مصادقة الخادم الآخر مطلوبة (Basic)" });
        return;
      }
      const peerAdmin = await authenticatePeer(credentials.username, credentials.password);
      if (!peerAdmin) {
        res.status(401).json({ error: "بيانات دخول الخادم الآخر غير صحيحة" });
        return;
      }
    }
    res.json(await getSyncNode());
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

// POST /api/sync/sessions — create a durable two-node exchange.
router.post("/sessions", async (req, res) => {
  try {
    const targetNodeId = String(req.body?.targetNodeId ?? "");
    const session = await createSyncSession({
      sessionId: req.body?.sessionId ? String(req.body.sessionId) : undefined,
      sourceNodeId: req.body?.sourceNodeId ? String(req.body.sourceNodeId) : undefined,
      targetNodeId,
    });
    await auditLog({
      req,
      action: "sync_session_create",
      entityType: "sync_session",
      details: { sessionId: session.sessionId, targetNodeId },
    });
    res.status(201).json(session);
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

router.get("/sessions/:sessionId", async (req, res) => {
  try {
    res.json(await getSyncSession(String(req.params.sessionId)));
  } catch (error) {
    res.status(404).json({ error: errorMessage(error) });
  }
});

// Exchange vectors and prepare the outgoing Delta. Repeating this call with
// the same vector returns the existing package rather than creating a second
// logical exchange.
router.post("/sessions/:sessionId/handshake", async (req, res) => {
  try {
    const node = await getSyncNode();
    const result = await handshakeSyncSession(
      String(req.params.sessionId),
      String(req.body?.nodeId ?? node.nodeId),
      req.body?.peerVector,
    );
    await auditLog({
      req,
      action: "sync_session_handshake",
      entityType: "sync_session",
      details: { sessionId: result.sessionId, nodeId: result.localNodeId },
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

router.post("/sessions/:sessionId/manifest", async (req, res) => {
  try {
    const node = await getSyncNode();
    const pkg = await prepareSyncPackage(
      String(req.params.sessionId),
      String(req.body?.nodeId ?? node.nodeId),
      req.body?.baseVector,
    );
    res.json({
      packageId: pkg.packageId,
      sessionId: pkg.sessionId,
      direction: pkg.direction,
      sourceNodeId: pkg.sourceNodeId,
      targetNodeId: pkg.targetNodeId,
      baseVector: pkg.baseVector,
      lastVector: pkg.lastVector,
      contentHash: pkg.contentHash,
      changeCount: Array.isArray(pkg.changes) ? pkg.changes.length : 0,
      status: pkg.status,
    });
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

// Upload a package received from the peer. The package is validated and
// applied atomically to Inbox/Change Log, then a detailed report is returned.
router.post("/sessions/:sessionId/packages", async (req, res) => {
  try {
    const node = await getSyncNode();
    const report = await applySyncPackage({
      sessionId: String(req.params.sessionId),
      nodeId: String(req.body?.nodeId ?? node.nodeId),
      packageId: String(req.body?.packageId ?? ""),
      direction: req.body?.direction,
      baseVector: req.body?.baseVector,
      lastVector: req.body?.lastVector,
      contentHash: String(req.body?.contentHash ?? ""),
      changes: req.body?.changes,
    });
    await auditLog({
      req,
      action: "sync_package_apply",
      entityType: "sync_package",
      details: { sessionId: report.packageId, packageId: report.packageId, counts: report.counts },
    });
    res.json(report);
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

router.get("/sessions/:sessionId/packages/:packageId", async (req, res) => {
  try {
    const pkg = await getSyncPackage(String(req.params.packageId));
    if (pkg.sessionId !== String(req.params.sessionId)) {
      res.status(404).json({ error: "SYNC_PACKAGE_NOT_FOUND" });
      return;
    }
    res.json(pkg);
  } catch (error) {
    res.status(404).json({ error: errorMessage(error) });
  }
});

router.post("/sessions/:sessionId/ack", async (req, res) => {
  try {
    const node = await getSyncNode();
    const result = await acknowledgeSyncPackage(
      String(req.params.sessionId),
      String(req.body?.packageId ?? ""),
      String(req.body?.nodeId ?? node.nodeId),
    );
    await auditLog({
      req,
      action: "sync_package_ack",
      entityType: "sync_package",
      details: { sessionId: req.params.sessionId, packageId: req.body?.packageId },
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

router.post("/pairings", async (req, res) => {
  try {
    res.status(201).json(await createPairing({
      targetNodeId: req.body?.targetNodeId ? String(req.body.targetNodeId) : null,
      ttlMs: Number.isFinite(Number(req.body?.ttlMs)) ? Number(req.body.ttlMs) : undefined,
    }));
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

router.post("/pairings/consume", async (req, res) => {
  try {
    const result = await consumePairing({
      code: String(req.body?.code ?? ""),
      nodeId: String(req.body?.nodeId ?? ""),
      nodeType: req.body?.nodeType ?? "web",
      label: req.body?.label ? String(req.body.label) : null,
    });
    await auditLog({ req, action: "sync_pairing_consume", entityType: "sync_trusted_node", details: result });
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

router.get("/trusted-nodes", async (_req, res) => {
  res.json(await listTrustedNodes());
});

router.post("/trusted-nodes/:nodeId/revoke", async (req, res) => {
  try {
    const nodeId = String(req.params.nodeId);
    const result = await revokeTrustedNode(nodeId);
    await auditLog({ req, action: "sync_trusted_node_revoke", entityType: "sync_trusted_node", details: { nodeId } });
    res.json(result);
  } catch (error) {
    res.status(404).json({ error: errorMessage(error) });
  }
});

router.get("/conflicts", async (req, res) => {
  const requested = String(req.query.status ?? "open");
  const status = ["open", "resolved", "deferred", "all"].includes(requested)
    ? requested as "open" | "resolved" | "deferred" | "all"
    : "open";
  const rows = await listSyncConflicts(status);
  // Flatten: { conflict, change } → conflict fields + nested change row.
  res.json(rows.map((row) => ({ ...row.conflict, change: row.change ?? null })));
});

router.post("/conflicts/:id/resolve", async (req, res) => {
  try {
    const conflictId = Number(req.params.id);
    const result = await resolveSyncConflict({
      conflictId,
      userId: res.locals.user.id,
      resolution: req.body?.resolution,
      correction: req.body?.correction,
    });
    await auditLog({
      req,
      action: "sync_conflict_resolve",
      entityType: "sync_conflict",
      details: { conflictId, resolution: req.body?.resolution },
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

router.post("/relay/packages", async (req, res) => {
  try {
    const result = await uploadRelayPackage({
      sessionId: String(req.body?.sessionId ?? ""),
      packageId: String(req.body?.packageId ?? ""),
      responseToRelayId: req.body?.responseToRelayId ? String(req.body.responseToRelayId) : null,
      direction: req.body?.direction,
      sourceNodeId: String(req.body?.sourceNodeId ?? ""),
      targetNodeId: String(req.body?.targetNodeId ?? ""),
      contentHash: String(req.body?.contentHash ?? ""),
      payloadBase64: String(req.body?.payloadBase64 ?? ""),
      expiresAt: req.body?.expiresAt ? String(req.body.expiresAt) : undefined,
    });
    await auditLog({ req, action: "sync_relay_upload", entityType: "sync_relay_package", details: result });
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

router.get("/relay/packages", async (req, res) => {
  res.json(await listRelayPackages(req.query.sessionId ? String(req.query.sessionId) : undefined));
});

router.get("/relay/packages/:relayId", async (req, res) => {
  try {
    const includePayload = req.query.download === "true";
    const result = await getRelayPackage(String(req.params.relayId), includePayload);
    res.json(result);
  } catch (error) {
    res.status(404).json({ error: errorMessage(error) });
  }
});

router.delete("/relay/expired", async (_req, res) => {
  const result = await purgeExpiredRelayPackages();
  res.json({ deleted: result.length });
});

/* ── Networked exchange + package import/export (approved 27-08-2026) ────── */

async function credentialsFromRequest(req: {
  headers: { authorization?: string };
}): Promise<{ username: string; password: string } | null> {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

async function authenticatePeer(
  username: string,
  password: string,
): Promise<{ id: number } | null> {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, username))
    .limit(1);
  if (!user || !user.isActive || user.role !== "admin") return null;
  const valid = await bcrypt.compare(password, user.passwordHash);
  return valid ? { id: user.id } : null;
}

async function peerFetch<T>(
  url: string,
  username: string,
  password: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const peerTimeoutMs = Number(process.env.SYNC_PEER_TIMEOUT_MS ?? 30_000);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
    ...(init.headers ?? {}),
  };
  const response = await fetch(url, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(
      Number.isFinite(peerTimeoutMs) && peerTimeoutMs > 0 ? peerTimeoutMs : 30_000,
    ),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(`استجابة الطرف الآخر ${response.status}: ${data.error ?? "خطأ غير معروف"}`);
  }
  return data;
}

function peerBaseVector(value: unknown): Record<string, number> {
  const vector =
    value && typeof value === "object" ? (value as Record<string, number>) : {};
  const safe: Record<string, number> = {};
  for (const [key, seq] of Object.entries(vector)) {
    if (typeof seq === "number" && Number.isSafeInteger(seq) && seq >= 0) {
      safe[key] = seq;
    }
  }
  return safe;
}

// POST /api/sync/exchange — dual mode:
//   A) Orchestrator: { peerUrl, username, password } — pull+push with a remote
//      server in a single round trip (server-to-server, no CORS involved).
//   B) Peer: { nodeId, vector, changes, baseVector } + Basic auth — serve the
//      other side of the exchange.
router.post("/exchange", async (req, res) => {
  try {
    const body = req.body ?? {};
    const local = await getSyncNode();

    if (typeof body.peerUrl === "string" && body.peerUrl) {
      // ── Orchestrator mode ───────────────────────────────────────────────
      if (!res.locals.user || res.locals.user.role !== "admin") {
        res.status(401).json({ error: "جلسة مدير مطلوبة لبدء المزامنة" });
        return;
      }
      const peerUrl = String(body.peerUrl).replace(/\/$/, "");
      const username = typeof body.username === "string" ? body.username : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (!/^https?:\/\//i.test(peerUrl)) {
        res.status(400).json({ error: "عنوان الخادم الآخر يجب أن يبدأ بـ http(s)://" });
        return;
      }
      if (!username || !password) {
        res.status(400).json({ error: "بيانات دخول مدير الخادم الآخر مطلوبة" });
        return;
      }

      // 1) Learn the peer's identity and vector.
      const peerNode = await peerFetch<{ nodeId: string; vector: Record<string, number> }>(
        `${peerUrl}/api/sync/node`,
        username,
        password,
      );
      // 2) Prepare our changes the peer does not have yet.
      const outgoing = await prepareOutgoingChanges(peerBaseVector(peerNode.vector));
      // 2b) Sign the request (non-repudiation): the peer verifies it with
      // our public key once we are a trusted node.
      const [nodeRow] = await db
        .select()
        .from(nodeIdentityTable)
        .where(eq(nodeIdentityTable.nodeId, local.nodeId))
        .limit(1);
      const signingKeys = await ensureNodeSigningKeys(
        nodeRow ?? { nodeId: local.nodeId, keyId: null, signingPublicKey: null, signingPrivateKey: null },
      );
      const signedAt = new Date().toISOString();
      const requestSignature = signPayload(
        exchangeSigningPayload({
          nodeId: local.nodeId,
          signedAt,
          vector: local.vector,
          changeCount: outgoing.length,
        }),
        signingKeys.privateKeyPem,
      );
      // 3) One round trip: send ours, receive theirs.
      const peerResponse = await peerFetch<{
        nodeId: string;
        vector: Record<string, number>;
        changes: unknown[];
        report: { counts?: { received?: number; applied?: number; duplicate?: number; conflicts?: number } };
        baseVector?: Record<string, number>;
        lastVector?: Record<string, number>;
        signingPublicKey?: string;
        signingKeyId?: string;
        signature?: string;
        signedAt?: string;
      }>(`${peerUrl}/api/sync/exchange`, username, password, {
        method: "POST",
        headers: {
          "x-dme-node": local.nodeId,
          "x-dme-signed-at": signedAt,
          "x-dme-signature": requestSignature,
        },
        body: {
          nodeId: local.nodeId,
          vector: local.vector,
          changes: outgoing,
          baseVector: peerBaseVector(peerNode.vector),
        },
      });
      // 2c) Record the peer's signing public key so future exchanges can be
      // verified, and verify this response when the key was already known.
      let peerSignatureVerification: "verified" | "unverified" | "invalid" = "unverified";
      if (typeof peerResponse.signingPublicKey === "string" && peerResponse.signingPublicKey) {
        await upsertTrustedPublicKey(peerNode.nodeId, peerResponse.signingPublicKey, "web");
      }
      const knownPeerKey =
        typeof peerResponse.signingPublicKey === "string" && peerResponse.signingPublicKey
          ? peerResponse.signingPublicKey
          : await getTrustedPublicKey(peerNode.nodeId);
      if (knownPeerKey && typeof peerResponse.signature === "string" && typeof peerResponse.signedAt === "string") {
        peerSignatureVerification = verifyPayload(
          exchangeSigningPayload({
            nodeId: peerNode.nodeId,
            signedAt: peerResponse.signedAt,
            vector: peerBaseVector(peerResponse.vector),
            changeCount: Array.isArray(peerResponse.changes) ? peerResponse.changes.length : 0,
          }),
          peerResponse.signature,
          knownPeerKey,
        )
          ? "verified"
          : "invalid";
      }
      if (peerSignatureVerification === "invalid") {
        res.status(403).json({ error: "توقيع العقدة النظيرة غير صالح — تحقق من هوية الخادم الهدف" });
        return;
      }
      // 4) Materialize the peer's changes locally.
      const localReport = await applyIncomingChanges({
        changes: peerResponse.changes ?? [],
        baseVector: peerBaseVector(peerResponse.baseVector ?? peerNode.vector),
        lastVector: peerBaseVector(peerResponse.lastVector ?? peerResponse.vector),
        sourceNodeId: peerNode.nodeId,
        contextUserId: res.locals.user?.id ?? null,
      });
      await auditLog({
        req,
        action: "sync_exchange",
        entityType: "sync_exchange",
        details: {
          peerUrl,
          peerNodeId: peerNode.nodeId,
          sent: outgoing.length,
          received: (peerResponse.changes ?? []).length,
          localApplied: localReport.counts.applied,
          peerApplied: peerResponse.report?.counts?.applied ?? 0,
          conflicts: localReport.counts.conflicts,
          peerSignature: peerSignatureVerification,
        },
      });
      res.json({
        peer: { nodeId: peerNode.nodeId, vector: peerNode.vector },
        sent: outgoing.length,
        received: (peerResponse.changes ?? []).length,
        local: localReport,
        peerReport: peerResponse.report ?? peerResponse,
        peerSignature: peerSignatureVerification,
      });
      return;
    }

    // ── Peer mode ─────────────────────────────────────────────────────────
    const credentials = await credentialsFromRequest(req);
    if (!credentials) {
      res.status(401).json({ error: "مصادقة الخادم الآخر مطلوبة (Basic)" });
      return;
    }
    const peerAdmin = await authenticatePeer(credentials.username, credentials.password);
    if (!peerAdmin) {
      res.status(401).json({ error: "بيانات دخول الخادم الآخر غير صحيحة" });
      return;
    }
    const peerNodeId = typeof body.nodeId === "string" ? body.nodeId : "";
    if (!peerNodeId) {
      res.status(400).json({ error: "nodeId الخاص بالطرف الآخر مطلوب" });
      return;
    }
    // Verify the caller's signature when we hold its public key. A mismatch
    // means either a compromised credential or an impersonation attempt.
    const trustedKey = await getTrustedPublicKey(peerNodeId);
    const incomingSignedAt = req.headers["x-dme-signed-at"];
    const incomingSignature = req.headers["x-dme-signature"];
    if (trustedKey) {
      const valid =
        typeof incomingSignedAt === "string" &&
        typeof incomingSignature === "string" &&
        verifyPayload(
          exchangeSigningPayload({
            nodeId: peerNodeId,
            signedAt: incomingSignedAt,
            vector: peerBaseVector(body.vector),
            changeCount: Array.isArray(body.changes) ? body.changes.length : 0,
          }),
          incomingSignature,
          trustedKey,
        );
      if (!valid) {
        await auditLog({
          req,
          action: "sync_exchange_rejected_signature",
          entityType: "sync_exchange",
          details: { peerNodeId },
        });
        res.status(403).json({ error: "توقيع العقدة غير صالح" });
        return;
      }
    }
    const report = await applyIncomingChanges({
      changes: body.changes ?? [],
      baseVector: peerBaseVector(body.baseVector),
      lastVector: peerBaseVector(body.lastVector),
      sourceNodeId: peerNodeId,
      contextUserId: peerAdmin.id,
    });
    const outgoing = await prepareOutgoingChanges(peerBaseVector(body.vector));
    const vector = await currentVector();
    // Sign the response with our own keypair so the orchestrator can verify
    // provenance once it holds our public key.
    const [peerNodeRow] = await db
      .select()
      .from(nodeIdentityTable)
      .where(eq(nodeIdentityTable.nodeId, local.nodeId))
      .limit(1);
    const peerSigningKeys = await ensureNodeSigningKeys(
      peerNodeRow ?? { nodeId: local.nodeId, keyId: null, signingPublicKey: null, signingPrivateKey: null },
    );
    const peerSignedAt = new Date().toISOString();
    const peerSignature = signPayload(
      exchangeSigningPayload({
        nodeId: local.nodeId,
        signedAt: peerSignedAt,
        vector,
        changeCount: outgoing.length,
      }),
      peerSigningKeys.privateKeyPem,
    );
    res.json({
      nodeId: local.nodeId,
      vector,
      changes: outgoing,
      report,
      baseVector: report.baseVector,
      lastVector: report.lastVector,
      signingKeyId: peerSigningKeys.keyId,
      signingPublicKey: peerSigningKeys.publicKeyPem,
      signature: peerSignature,
      signedAt: peerSignedAt,
    });
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

// POST /api/sync/export — build a .dme-sync package (delta when a base
// vector is provided, full otherwise) for manual transfer.
router.post("/export", async (req, res) => {
  try {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (password.length < 8) {
      res.status(400).json({ error: "كلمة مرور الحزمة مطلوبة (8 أحرف على الأقل)" });
      return;
    }
    const baseVector =
      req.body?.baseVector && typeof req.body.baseVector === "object"
        ? peerBaseVector(req.body.baseVector)
        : undefined;
    const hasBase = baseVector && Object.keys(baseVector).length > 0;
    let buffer = hasBase
      ? await createDeltaBackup(password, baseVector)
      : await createFullBackup(password);
    // Sign the envelope (non-repudiation): the signature is added to the
    // plaintext header without re-encrypting the payload.
    try {
      const nodeRow = await getSyncNode();
      const [signingNodeRow] = await db
        .select()
        .from(nodeIdentityTable)
        .where(eq(nodeIdentityTable.nodeId, nodeRow.nodeId))
        .limit(1);
      const signingKeys = await ensureNodeSigningKeys(
        signingNodeRow ?? { nodeId: nodeRow.nodeId, keyId: null, signingPublicKey: null, signingPrivateKey: null },
      );
      buffer = signPackageBuffer(buffer, {
        keys: signingKeys,
        nodeId: nodeRow.nodeId,
        packageType: hasBase ? "delta-sync" : "full-backup",
      });
    } catch (signingError) {
      logger.warn({ error: signingError }, "Could not sign sync package; exporting unsigned");
    }
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="damascus-sync-${date}.dme-sync"`,
    );
    res.send(buffer);
    await auditLog({
      req,
      action: "sync_package_export",
      entityType: "sync_package",
      details: { bytes: buffer.length, delta: hasBase },
    });
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

// POST /api/sync/import — apply a .dme-sync package as a sync operation
// (change-log replay + business materialization), falling back to a merge
// restore for records-only packages.
router.post("/import", async (req, res) => {
  try {
    const packageBase64 = typeof req.body?.packageBase64 === "string" ? req.body.packageBase64 : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!packageBase64) {
      res.status(400).json({ error: "ملف الحزمة مطلوب" });
      return;
    }
    const pkg = decodePackage(packageBase64, password);
    const manifest = pkg.manifest as Record<string, unknown>;
    const changes = (pkg.changes ?? []) as unknown[];
    // Verify the package signature when present (forward compatible: legacy
    // unsigned packages are accepted and reported as unverified).
    let signatureVerification: "verified" | "unverified" | "invalid" = "unverified";
    const signatureInfo = (pkg as { signatureInfo?: { signature?: string; checksum?: string; signingPublicKey?: string } }).signatureInfo;
    if (signatureInfo?.signature && signatureInfo.signingPublicKey) {
      const payload = packageSigningPayload(
        String(signatureInfo.checksum ?? ""),
        String(manifest.packageType ?? "full-backup"),
      );
      signatureVerification = verifyPayload(
        payload,
        signatureInfo.signature,
        signatureInfo.signingPublicKey,
      )
        ? "verified"
        : "invalid";
      if (signatureVerification === "invalid") {
        res.status(400).json({ error: "توقيع الحزمة غير صالح — رفض الاستيراد" });
        return;
      }
    }
    const baseVector = peerBaseVector(
      (pkg as { baseVector?: unknown }).baseVector ??
        (manifest.baseVector ?? (manifest as { lastVector?: unknown }).lastVector ?? {}),
    );
    const lastVector = peerBaseVector(
      (pkg as { lastVector?: unknown }).lastVector ?? (manifest.lastVector ?? {}),
    );
    if (changes.length > 0) {
      const report = await applyIncomingChanges({
        changes,
        baseVector,
        lastVector,
        sourceNodeId: String(manifest.sourceNodeId ?? "unknown"),
        contextUserId: res.locals.user?.id ?? null,
      });
      await auditLog({
        req,
        action: "sync_package_import",
        entityType: "sync_package",
        details: { packageType: manifest.packageType, report: report.counts },
      });
      res.json({ mode: "sync-apply", report, summary: packageSummary(pkg), signatureVerification });
      return;
    }
    // Records-only package (legacy backup) → merge restore.
    const report = await applyRestore(pkg, "merge", res.locals.user?.id ?? null);
    await auditLog({
      req,
      action: "sync_package_import_merge",
      entityType: "sync_package",
      details: { packageType: manifest.packageType, report: report.counts },
    });
    res.json({ mode: "merge-restore", report, summary: packageSummary(pkg), signatureVerification });
  } catch (error) {
    res.status(400).json({ error: errorMessage(error) });
  }
});

// GET /api/sync/overview
// One screen for the person who runs synchronisation across many sites:
// node identity, this site's warehouse, pending outbound changes, open
// conflicts, trusted peers and the exchange cursors.
router.get("/overview", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const node = await getSyncNode();
    const warehouse = await getCurrentWarehouse();
    const trustedNodes = await listTrustedNodes();

    const [pending] = await db
      .select({ count: sql<number>`count(*)` })
      .from(syncOutboxTable)
      .where(eq(syncOutboxTable.status, "pending"));
    const [exported] = await db
      .select({ count: sql<number>`count(*)` })
      .from(syncOutboxTable)
      .where(eq(syncOutboxTable.status, "exported"));
    const [openConflicts] = await db
      .select({ count: sql<number>`count(*)` })
      .from(syncConflictTable)
      .where(eq(syncConflictTable.status, "open"));
    const [rejected] = await db
      .select({ count: sql<number>`count(*)` })
      .from(syncInboxTable)
      .where(eq(syncInboxTable.status, "rejected"));
    const cursors = await db.select().from(syncCursorTable);

    res.json({
      node: {
        nodeId: node?.nodeId ?? null,
        installationId: node?.installationId ?? null,
        nodeType: node?.nodeType ?? null,
      },
      warehouse,
      peers: {
        trusted: trustedNodes.length,
        cursors: cursors.map((c) => ({ peerNodeId: c.peerNodeId, vector: c.vector, updatedAt: c.updatedAt })),
      },
      outbox: {
        pending: Number(pending?.count ?? 0),
        exported: Number(exported?.count ?? 0),
      },
      conflicts: { open: Number(openConflicts?.count ?? 0) },
      inbox: { rejected: Number(rejected?.count ?? 0) },
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "حدث خطأ غير متوقع في الخادم." });
  }
});

export default router;