import { describe, expect, it } from "vitest";
import {
  mergeVectors,
  missingSequences,
  validatePortableChange,
  validatePortableNodeIdentity,
} from "./index";

describe("portable sync contract", () => {
  it("merges vectors monotonically", () => {
    expect(mergeVectors({ nodeA: 2 }, { nodeA: 1, nodeB: 4 })).toEqual({
      nodeA: 2,
      nodeB: 4,
    });
  });

  it("does not move a vector backwards", () => {
    expect(mergeVectors({ nodeA: 9 }, { nodeA: 3 })).toEqual({ nodeA: 9 });
  });

  it("rejects invalid vector sequence values", () => {
    expect(() => mergeVectors({ nodeA: -1 })).toThrow("SYNC_VECTOR_INVALID");
    expect(() => mergeVectors({ nodeA: 1.5 })).toThrow("SYNC_VECTOR_INVALID");
  });

  it("returns only the missing contiguous range per origin", () => {
    expect(missingSequences({ nodeA: 3, nodeB: 8 }, { nodeA: 5, nodeB: 8, nodeC: 2 })).toEqual([
      { nodeId: "nodeA", from: 4, to: 5 },
      { nodeId: "nodeC", from: 1, to: 2 },
    ]);
  });

  it("validates portable node identity", () => {
    expect(validatePortableNodeIdentity({
      nodeId: "node-a",
      installationId: "install-a",
      nodeType: "windows",
      originSequence: 0,
      createdAt: "2026-09-17T00:00:00.000Z",
    }).nodeId).toBe("node-a");
    expect(() => validatePortableNodeIdentity({
      nodeId: "node-a",
      installationId: "install-a",
      nodeType: "ios" as never,
      originSequence: 0,
      createdAt: "2026-09-17T00:00:00.000Z",
    })).toThrow("SYNC_NODE_TYPE_INVALID");
  });

  it("requires a positive origin sequence for changes", () => {
    expect(() => validatePortableChange({
      changeId: "change-a",
      operationId: "operation-a",
      entityType: "item",
      entityGlobalId: "entity-a",
      originNodeId: "node-a",
      originSequence: 0,
      changeType: "create",
      payload: {},
      createdAt: "2026-09-17T00:00:00.000Z",
    })).toThrow("SYNC_SEQUENCE_INVALID");
  });

  it("rejects changes without an identity or object payload", () => {
    expect(() => validatePortableChange({
      changeId: "",
      operationId: "operation-a",
      entityType: "item",
      entityGlobalId: "entity-a",
      originNodeId: "node-a",
      originSequence: 1,
      changeType: "create",
      payload: {},
      createdAt: "2026-09-17T00:00:00.000Z",
    })).toThrow("SYNC_CHANGE_IDENTITY_INVALID");
    expect(() => validatePortableChange({
      changeId: "change-a",
      operationId: "operation-a",
      entityType: "item",
      entityGlobalId: "entity-a",
      originNodeId: "node-a",
      originSequence: 1,
      changeType: "create",
      payload: null as never,
      createdAt: "2026-09-17T00:00:00.000Z",
    })).toThrow("SYNC_CHANGE_PAYLOAD_INVALID");
  });
});