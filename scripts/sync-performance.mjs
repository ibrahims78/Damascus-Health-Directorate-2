#!/usr/bin/env node
import { createHash } from "node:crypto";

const sizes = [
  ["S", 100],
  ["M", 1_000],
  ["L", 10_000],
];

function makeChanges(count) {
  return Array.from({ length: count }, (_, index) => ({
    changeId: `change-${index + 1}`,
    operationId: `operation-${index + 1}`,
    entityType: index % 3 === 0 ? "item" : "equipment",
    entityGlobalId: `entity-${index % Math.max(1, Math.floor(count / 10))}`,
    originNodeId: `node-${index % 4}`,
    originSequence: Math.floor(index / 4) + 1,
    changeType: "update",
    payload: { index, currentStock: index % 101, note: "synthetic" },
  }));
}

function measure(label, count) {
  const changes = makeChanges(count);
  const start = performance.now();
  changes.sort((a, b) =>
    a.originNodeId.localeCompare(b.originNodeId) ||
    a.originSequence - b.originSequence ||
    a.changeId.localeCompare(b.changeId),
  );
  const payload = JSON.stringify(changes);
  const digest = createHash("sha256").update(payload).digest("hex");
  const elapsedMs = Math.max(0.001, performance.now() - start);
  return {
    size: label,
    changes: count,
    elapsedMs: Number(elapsedMs.toFixed(3)),
    payloadBytes: Buffer.byteLength(payload),
    changesPerSecond: Math.round((count * 1000) / elapsedMs),
    digestPrefix: digest.slice(0, 12),
  };
}

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  node: process.version,
  results: sizes.map(([label, count]) => measure(label, count)),
}, null, 2));