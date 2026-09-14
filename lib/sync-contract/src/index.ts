export type PortableNodeType = "windows" | "android" | "web";
export type PortableVector = Record<string, number>;

export type PortableNodeIdentity = {
  nodeId: string;
  installationId: string;
  nodeType: PortableNodeType;
  originSequence: number;
  createdAt: string;
};

export type PortableChange = {
  changeId: string;
  operationId: string;
  entityType: string;
  entityGlobalId: string;
  originNodeId: string;
  originSequence: number;
  changeType: "create" | "update" | "delete" | "correction" | "system-reconciliation";
  payload: Record<string, unknown>;
  createdAt: string;
};

export function mergeVectors(...vectors: PortableVector[]): PortableVector {
  const result: PortableVector = {};
  for (const vector of vectors) {
    for (const [nodeId, sequence] of Object.entries(vector)) {
      if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error("SYNC_VECTOR_INVALID");
      result[nodeId] = Math.max(result[nodeId] ?? 0, sequence);
    }
  }
  return result;
}

export function missingSequences(
  current: PortableVector,
  incoming: PortableVector,
): Array<{ nodeId: string; from: number; to: number }> {
  return Object.entries(incoming)
    .filter(([nodeId, sequence]) => sequence > (current[nodeId] ?? 0))
    .map(([nodeId, sequence]) => ({ nodeId, from: (current[nodeId] ?? 0) + 1, to: sequence }));
}

export function validatePortableNodeIdentity(identity: PortableNodeIdentity): PortableNodeIdentity {
  if (!identity.nodeId || !identity.installationId || !identity.createdAt) throw new Error("SYNC_NODE_IDENTITY_INVALID");
  if (!["windows", "android", "web"].includes(identity.nodeType)) throw new Error("SYNC_NODE_TYPE_INVALID");
  if (!Number.isSafeInteger(identity.originSequence) || identity.originSequence < 0) throw new Error("SYNC_SEQUENCE_INVALID");
  return identity;
}

export function validatePortableChange(change: PortableChange): PortableChange {
  if (!change.changeId || !change.operationId || !change.entityGlobalId || !change.originNodeId) {
    throw new Error("SYNC_CHANGE_IDENTITY_INVALID");
  }
  if (!Number.isSafeInteger(change.originSequence) || change.originSequence < 1) throw new Error("SYNC_SEQUENCE_INVALID");
  if (!change.payload || typeof change.payload !== "object") throw new Error("SYNC_CHANGE_PAYLOAD_INVALID");
  return change;
}