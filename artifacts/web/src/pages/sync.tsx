import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { CopyButton } from "@/components/copy-button";
import { AlertTriangle, CircleDot, RefreshCw, ShieldCheck, Warehouse as WarehouseIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type NodeInfo = { nodeId: string; installationId: string; nodeType: string; vector: Record<string, number> };
type TrustedNode = { nodeId: string; nodeType: string; label?: string | null; status: string; pairedAt: string };
type Conflict = {
  conflict: { id: number; conflictCode: string; severity: string; status: string; createdAt: string };
  change: { entityType: string; entityGlobalId: string; operationId: string; payload: unknown } | null;
};
type RelayPackage = {
  relayId: string;
  sessionId: string;
  packageId: string;
  direction: string;
  sourceNodeId: string;
  targetNodeId: string;
  status: string;
  expiresAt: string;
  transportHash: string;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/sync${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "تعذر تنفيذ طلب المزامنة");
  return body;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ar-SY", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function SyncPage() {
  const [node, setNode] = useState<NodeInfo | null>(null);
  const [nodes, setNodes] = useState<TrustedNode[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [relayPackages, setRelayPackages] = useState<RelayPackage[]>([]);
  const [pairingCode, setPairingCode] = useState("");
  const [consumeCode, setConsumeCode] = useState("");
  const [pairingTargetNodeId, setPairingTargetNodeId] = useState("");
  const [consumeNodeId, setConsumeNodeId] = useState("");
  const [targetNodeId, setTargetNodeId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [manualFile, setManualFile] = useState<File | null>(null);
  const [peerUrl, setPeerUrl] = useState("");
  const [peerUsername, setPeerUsername] = useState("admin");
  const [peerPassword, setPeerPassword] = useState("");
  const [exchangeResult, setExchangeResult] = useState<string | null>(null);
  const [exportPassword, setExportPassword] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPassword, setImportPassword] = useState("");
  const [importResult, setImportResult] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeStep, setActiveStep] = useState("identity");
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [confirmImportOpen, setConfirmImportOpen] = useState(false);

  const steps = useMemo(() => [
    { id: "identity", label: "هوية العقدة", hint: "Node ID وعداد التغييرات" },
    { id: "pairing", label: "الاقتران", hint: "الثقة والرمز أحادي الاستخدام" },
    { id: "exchange", label: "التبادل", hint: "إرسال واستقبال مع ACK" },
    { id: "relay", label: "Relay", hint: "نقل ملف مشفر كما هو" },
    { id: "conflicts", label: "التعارضات", hint: "قرار موثق لكل تعارض" },
  ], []);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [nodeResult, trustedResult, conflictsResult, relayResult] = await Promise.all([
        api<NodeInfo>("/node"),
        api<TrustedNode[]>("/trusted-nodes"),
        api<Conflict[]>("/conflicts"),
        api<RelayPackage[]>("/relay/packages"),
      ]);
      setNode(nodeResult);
      setNodes(trustedResult);
      setConflicts(conflictsResult);
      setRelayPackages(relayResult);
    } catch (refreshError) {
      setError((refreshError as Error).message);
      throw refreshError;
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  async function createPairing() {
    setActiveStep("pairing");
    setError(null);
    setBusy(true);
    try {
      const result = await api<{ code: string; expiresAt: string }>("/pairings", {
        method: "POST",
        body: JSON.stringify({ targetNodeId: pairingTargetNodeId || undefined }),
      });
      setPairingCode(result.code);
      setMessage(`رمز الاقتران صالح حتى ${formatDate(result.expiresAt)} ويُستخدم مرة واحدة.`);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function consumePairing() {
    setActiveStep("pairing");
    setError(null);
    setBusy(true);
    try {
      await api("/pairings/consume", {
        method: "POST",
        body: JSON.stringify({ code: consumeCode, nodeId: consumeNodeId, nodeType: "web", label: "عقدة ويب" }),
      });
      setConsumeCode("");
      setConsumeNodeId("");
      setMessage("تمت إضافة العقدة إلى قائمة الثقة.");
      await refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resolveConflict(id: number, resolution: "approve" | "reject" | "defer") {
    setActiveStep("conflicts");
    setError(null);
    setBusy(true);
    try {
      await api(`/conflicts/${id}/resolve`, { method: "POST", body: JSON.stringify({ resolution }) });
      setMessage("تم حفظ قرار التسوية في سجل التدقيق.");
      await refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runExchange() {
    setActiveStep("exchange");
    setError(null);
    if (!peerUrl || !peerUsername || !peerPassword) {
      setError("أدخل عنوان الخادم واسم المستخدم وكلمة المرور.");
      return;
    }
    setBusy(true);
    try {
      const result = await api<{
        sent: number;
        received: number;
        local: { counts: Record<string, number> };
        peerReport: { counts: Record<string, number> };
      }>("/exchange", {
        method: "POST",
        body: JSON.stringify({ peerUrl, username: peerUsername, password: peerPassword }),
      });
      const summarize = (counts: Record<string, number>) =>
        `مستلم ${counts.received ?? 0}، مطبق ${counts.applied ?? 0}، مكرر ${counts.duplicate ?? 0}، تعارض ${counts.conflicts ?? 0}`;
      setExchangeResult(
        `اكتمل التبادل — أرسلنا ${result.sent} تغييراً واستقبلنا ${result.received}. ` +
          `محلياً: ${summarize(result.local?.counts ?? {})}. ` +
          `لدى الطرف الآخر: ${summarize(result.peerReport?.counts ?? {})}.`,
      );
      setLastSyncAt(new Date().toISOString());
      setMessage("تم استلام ACK من الطرف الآخر وتحديث حالة الجلسة.");
      await refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function exportPackage() {
    setActiveStep("relay");
    setError(null);
    if (!exportPassword) {
      setError("أدخل كلمة مرور الحزمة.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/sync/export", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: exportPassword }),
      });
      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || "فشل تصدير الحزمة");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `dme-sync-${new Date().toISOString().slice(0, 10)}.dme-sync`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage("تم تصدير حزمة المزامنة — انقل الملف إلى النسخة الأخرى واستوردها من صفحة المزامنة هناك.");
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function importPackage() {
    setActiveStep("relay");
    const selectedFile = importFile;
    const selectedPassword = importPassword;
    if (!selectedFile || !selectedPassword) {
      setError("اختر ملف الحزمة وأدخل كلمة المرور.");
      return;
    }
    setConfirmImportOpen(true);
  }

  async function confirmImportPackage() {
    setConfirmImportOpen(false);
    setError(null);
    const selectedFile = importFile;
    const selectedPassword = importPassword;
    if (!selectedFile || !selectedPassword) {
      setError("اختر ملف الحزمة وأدخل كلمة المرور.");
      return;
    }
    setBusy(true);
    try {
      const bytes = new Uint8Array(await selectedFile.arrayBuffer());
      let binary = "";
      for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
      }
      const result = await api<{ mode: string; report: { counts: Record<string, number> } }>("/import", {
        method: "POST",
        body: JSON.stringify({ packageBase64: btoa(binary), password: selectedPassword }),
      });
      const counts = result.report?.counts ?? {};
      setImportResult(
        `استُقبلت ${counts.received ?? 0} تغييراً: مطبق ${counts.applied ?? 0}، مكرر ${counts.duplicate ?? 0}، تعارض ${counts.conflicts ?? 0}، مرفوض ${counts.rejected ?? 0}.`,
      );
      await refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadManualFile() {
    setActiveStep("relay");
    setError(null);
    if (!manualFile || !sessionId || !node?.nodeId || !targetNodeId) {
      setError("أدخل Session ID وNode ID للوجهة واختر ملف .dme-sync أولاً.");
      return;
    }
    setBusy(true);
    try {
      const bytes = new Uint8Array(await manualFile.arrayBuffer());
      let binary = "";
      for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
      }
      const payloadBase64 = btoa(binary);
      await api("/relay/packages", {
        method: "POST",
        body: JSON.stringify({
          sessionId,
          packageId: manualFile.name,
          direction: "source-to-target",
          sourceNodeId: node.nodeId,
          targetNodeId,
          contentHash: "client-file-transfer",
          payloadBase64,
        }),
      });
      setManualFile(null);
      setMessage("تم رفع الملف المشفر إلى Relay. لا يقرأ الخادم محتواه.");
      await refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function downloadManualFile(relayId: string, packageId: string) {
    setActiveStep("relay");
    setError(null);
    setBusy(true);
    try {
      const result = await api<{ payloadBase64: string }>(`/relay/packages/${relayId}?download=true`);
      const binary = atob(result.payloadBase64);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = packageId.endsWith(".dme-sync") ? packageId : `${packageId}.dme-sync`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage("تم تنزيل الملف. يجب فحصه محلياً قبل التطبيق.");
      await refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 max-w-6xl" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">المزامنة والنسخ المرحّل</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          إدارة عقد المزامنة، نقل ملفات ‎.dme-sync‎ المشفرة، ومراجعة التعارضات قبل تطبيقها.
        </p>
      </div>

      <SyncManagementPanel />

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="space-y-4 p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold">مسار مزامنة واضح وآمن</p>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">
                ابدأ بالهوية، ثم الاقتران، ثم نفّذ التبادل أو انقل ملفًا مشفرًا. لا تعتبر الجلسة مكتملة قبل ظهور ACK.
              </p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-5">
            {steps.map((step, index) => {
              const active = step.id === activeStep;
              return (
                <button
                  type="button"
                  key={step.id}
                  onClick={() => setActiveStep(step.id)}
                  className={`rounded-lg border p-3 text-right transition-colors ${active ? "border-primary bg-background shadow-sm" : "bg-background/50 hover:bg-background"}`}
                  aria-current={active ? "step" : undefined}
                >
                  <span className="flex items-center justify-between gap-2 text-xs font-bold">
                    <span>{index + 1}. {step.label}</span>
                    {active ? <CircleDot className="h-4 w-4 text-primary" /> : <span className="text-muted-foreground">○</span>}
                  </span>
                  <span className="mt-1 block text-[11px] text-muted-foreground">{step.hint}</span>
                </button>
              );
            })}
          </div>
          <Progress value={((steps.findIndex((step) => step.id === activeStep) + 1) / steps.length) * 100} aria-label="تقدم خطوات المزامنة" />
        </CardContent>
      </Card>

      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</span>
          <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={busy}>
            <RefreshCw className="h-4 w-4" /> إعادة المحاولة
          </Button>
        </div>
      )}
      {message && <div role="status" className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm">{message}</div>}

      <Card>
        <CardHeader><CardTitle>مزامنة شبكية مباشرة</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            تبادل فوري للتغييرات مع خادم آخر عبر الشبكة — يتطلب وصولاً مباشراً إلى عنوانه وبيانات مشرف على الطرف الآخر.
          </p>
          <div className="flex flex-wrap gap-2">
            <Input value={peerUrl} onChange={(event) => setPeerUrl(event.target.value)} placeholder="عنوان الخادم، مثال: http://192.168.1.50:8080" dir="ltr" className="min-w-[260px] flex-1" />
            <Input value={peerUsername} onChange={(event) => setPeerUsername(event.target.value)} placeholder="اسم المستخدم" className="max-w-[150px]" />
            <Input type="password" value={peerPassword} onChange={(event) => setPeerPassword(event.target.value)} placeholder="كلمة المرور" className="max-w-[150px]" />
            <Button onClick={runExchange} disabled={busy}>مزامنة الآن</Button>
          </div>
          {exchangeResult && <div className="rounded border bg-muted/40 px-3 py-2 text-sm">{exchangeResult}</div>}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>هوية هذه العقدة</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div><span className="text-muted-foreground">النوع: </span>{node?.nodeType ?? "—"}</div>
            <div className="flex items-start gap-1">
              <span className="text-muted-foreground">Node ID: </span>
              <span className="break-all" dir="ltr">{node?.nodeId ?? "جار التحميل…"}</span>
              <CopyButton value={node?.nodeId} label="Node ID" />
            </div>
            <div className="flex items-start gap-1">
              <span className="text-muted-foreground">Installation ID: </span>
              <span className="break-all" dir="ltr">{node?.installationId ?? "—"}</span>
              <CopyButton value={node?.installationId} label="Installation ID" />
            </div>
            <div><span className="text-muted-foreground">التغييرات المسجلة: </span>{node ? Object.values(node.vector).reduce((sum, value) => sum + value, 0) : "—"}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>اقتران عقدة</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input value={pairingTargetNodeId} onChange={(event) => setPairingTargetNodeId(event.target.value)} placeholder="Node ID للوجهة (اختياري)" dir="ltr" />
              <Button onClick={createPairing} disabled={busy}>إنشاء رمز</Button>
            </div>
            {pairingCode && (
              <div className="flex items-center justify-center gap-2 rounded border border-primary/30 bg-primary/5 p-4">
                <span className="text-2xl font-bold tracking-[0.3em]" dir="ltr">{pairingCode}</span>
                <CopyButton value={pairingCode} label="رمز الاقتران" />
              </div>
            )}
            <div className="flex gap-2">
              <Input value={consumeCode} onChange={(event) => setConsumeCode(event.target.value)} placeholder="إدخال رمز من عقدة أخرى" dir="ltr" />
              <Input value={consumeNodeId} onChange={(event) => setConsumeNodeId(event.target.value)} placeholder="Node ID للعقدة المصدر" dir="ltr" />
              <Button variant="outline" onClick={consumePairing} disabled={busy || !consumeCode || !consumeNodeId}>اعتماد</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>العقد الموثوقة</CardTitle></CardHeader>
        <CardContent>
          {nodes.length === 0 ? <p className="text-sm text-muted-foreground">لا توجد عقد مقترنة بعد.</p> : (
            <div className="space-y-2">
              {nodes.map((trusted) => (
                <div key={trusted.nodeId} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm">
                  <div><strong>{trusted.label || trusted.nodeType}</strong><div className="break-all text-xs text-muted-foreground" dir="ltr">{trusted.nodeId}</div></div>
                  <div className="flex items-center gap-2"><Badge variant={trusted.status === "trusted" ? "default" : "secondary"}>{trusted.status === "trusted" ? "موثوقة" : "ملغاة"}</Badge><span className="text-xs text-muted-foreground">{formatDate(trusted.pairedAt)}</span></div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>نقل ملف ‎.dme-sync‎ يدوياً</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">يُحفظ الملف مشفراً كما هو؛ Relay لا يفك التشفير ولا يطبّق الحزمة.</p>
            <Input value={targetNodeId} onChange={(event) => setTargetNodeId(event.target.value)} placeholder="Node ID للوجهة" dir="ltr" />
            <Input type="file" accept=".dme-sync,application/octet-stream" onChange={(event) => setManualFile(event.target.files?.[0] ?? null)} />
            <Button className="w-full" onClick={uploadManualFile} disabled={busy || !manualFile}>رفع إلى Relay</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>حزم Relay المتاحة</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Input value={sessionId} onChange={(event) => setSessionId(event.target.value)} placeholder="تصفية حسب Session ID" dir="ltr" />
            {relayPackages.filter((item) => !sessionId || item.sessionId === sessionId).map((item) => (
              <div key={item.relayId} className="rounded border p-3 text-xs">
                <div className="flex justify-between gap-2"><Badge>{item.status}</Badge><span>{formatDate(item.expiresAt)}</span></div>
                <div className="mt-1 break-all" dir="ltr">{item.relayId}</div>
                <div className="flex items-center justify-between gap-2 text-muted-foreground">
                  <span>{item.direction} · {item.packageId}</span>
                  <Button size="sm" variant="outline" onClick={() => downloadManualFile(item.relayId, item.packageId)} disabled={busy}>تنزيل</Button>
                </div>
              </div>
            ))}
            {relayPackages.length === 0 && <p className="text-sm text-muted-foreground">لا توجد حزم معلقة.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>تصدير حزمة مزامنة</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              تنزيل كل التغييرات المحلية في ملف <span dir="ltr">.dme-sync</span> مشفّر، لنقله يدوياً (فلاش / بريد / تطبيق ملفات) إلى نسخة أخرى واستيراده هناك.
            </p>
            <Input type="password" value={exportPassword} onChange={(event) => setExportPassword(event.target.value)} placeholder="كلمة مرور الحزمة (8 أحرف على الأقل)" />
            <Button className="w-full" onClick={exportPackage} disabled={busy || !exportPassword}>تنزيل الحزمة</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>استيراد حزمة مزامنة</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              استيراد ملف <span dir="ltr">.dme-sync</span> من نسخة أخرى وتطبيق تغييراته، مع رصد التعارضات وعدم تكرار التطبيق عند إعادة الاستيراد.
            </p>
            <Input type="file" accept=".dme-sync,application/octet-stream" onChange={(event) => setImportFile(event.target.files?.[0] ?? null)} />
            <Input type="password" value={importPassword} onChange={(event) => setImportPassword(event.target.value)} placeholder="كلمة مرور الحزمة" />
            <Button className="w-full" onClick={importPackage} disabled={busy || !importFile || !importPassword}>استيراد وتطبيق</Button>
            {importResult && <div className="rounded border bg-muted/40 px-3 py-2 text-sm">{importResult}</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>طابور التعارضات</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {conflicts.length === 0 && <p className="text-sm text-muted-foreground">لا توجد تعارضات مفتوحة.</p>}
            {conflicts.map(({ conflict, change }) => (
              <div key={conflict.id} className={`rounded border p-3 ${conflict.severity === "critical" || conflict.severity === "high" ? "border-destructive/40 bg-destructive/5" : conflict.severity === "medium" ? "border-amber-500/40 bg-amber-500/5" : "bg-muted/20"}`}>
                <div className="flex items-center justify-between gap-2"><strong>{conflict.conflictCode}</strong><Badge variant={conflict.severity === "critical" || conflict.severity === "high" ? "destructive" : "secondary"}>{conflict.severity === "critical" ? "حرج" : conflict.severity === "high" ? "مرتفع" : conflict.severity === "medium" ? "متوسط" : "منخفض"}</Badge></div>
                <p className="mt-1 text-xs text-muted-foreground">{change?.entityType} · {change?.entityGlobalId}</p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => resolveConflict(conflict.id, "approve")} disabled={busy}>اعتماد</Button>
                  <Button size="sm" variant="outline" onClick={() => resolveConflict(conflict.id, "reject")} disabled={busy}>رفض</Button>
                  <Button size="sm" variant="ghost" onClick={() => resolveConflict(conflict.id, "defer")} disabled={busy}>تأجيل</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {lastSyncAt && (
        <p className="text-xs text-muted-foreground">
          آخر تبادل ناجح: {formatDate(lastSyncAt)} — ACK مؤكد
        </p>
      )}

      <AlertDialog open={confirmImportOpen} onOpenChange={setConfirmImportOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تطبيق حزمة المزامنة؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيقرأ النظام الحزمة محليًا ويطبق التغييرات المقبولة فقط، مع إبقاء التكرارات والتعارضات في التقرير. لا تتابع إلا إذا كان اتجاه النقل والملف المقصود صحيحين.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmImportPackage()} disabled={busy}>
              تطبيق الحزمة
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

type SyncOverview = {
  node: { nodeId: string | null; installationId: string | null; nodeType: string | null };
  warehouse: { id: number; code: string; name: string; type: string } | null;
  peers: { trusted: number; cursors: Array<{ peerNodeId: string; updatedAt: string }> };
  outbox: { pending: number; exported: number };
  conflicts: { open: number };
  inbox: { rejected: number };
};

/**
 * Phase 7 - management view for the person running synchronisation across
 * many sites (50 warehouses). Read-only: the actual exchange still happens
 * through the encrypted .dme-sync packages below.
 */
function SyncManagementPanel() {
  const [data, setData] = useState<SyncOverview | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/sync/overview", { credentials: "include" });
      if (!res.ok) {
        setData(null);
        return;
      }
      setData((await res.json()) as SyncOverview);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) return null;

  const metrics: Array<{ label: string; value: string | number; warn?: boolean }> = [
    { label: "هذا الجهاز", value: data.node.installationId ? String(data.node.installationId).slice(0, 8) : "—" },
    { label: "المستودع", value: data.warehouse ? `${data.warehouse.name} (${data.warehouse.code})` : "—" },
    { label: "تغييرات معلّقة للتصدير", value: data.outbox.pending, warn: data.outbox.pending > 0 },
    { label: "تغييرات مُصدَّرة بانتظار الإقرار", value: data.outbox.exported },
    { label: "تعارضات مفتوحة", value: data.conflicts.open, warn: data.conflicts.open > 0 },
    { label: "عُقد موثوقة", value: data.peers.trusted },
    { label: "واردات مرفوضة", value: data.inbox.rejected, warn: data.inbox.rejected > 0 },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <WarehouseIcon className="h-5 w-5 text-primary" aria-hidden="true" />
          لوحة إدارة المزامنة
        </CardTitle>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> تحديث
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {metrics.map((m) => (
            <div key={m.label} className="rounded-lg border p-3">
              <p className="text-[11px] text-muted-foreground">{m.label}</p>
              <p className={`mt-1 text-lg font-bold ${m.warn ? "text-amber-600" : ""}`}>{m.value}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
