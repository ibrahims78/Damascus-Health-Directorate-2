/**
 * SSE (Server-Sent Events) manager for real-time alert broadcasting.
 * When the alert worker detects a change, it calls broadcastAlertUpdate()
 * which pushes a refresh signal to every connected browser tab.
 */
import type { Response } from "express";
import { randomUUID } from "crypto";

type SSEClient = {
  userId: number;
  res: Response;
};

const clients = new Map<string, SSEClient>();

export function addSSEClient(
  userId: number,
  res: Response
): () => void {
  const clientId = randomUUID();
  clients.set(clientId, { userId, res });
  return () => clients.delete(clientId);
}

/** Push a lightweight "alerts changed" signal to all connected tabs. */
export function broadcastAlertUpdate(): void {
  const data = `data: ${JSON.stringify({ type: "update" })}\n\n`;
  for (const [id, client] of clients) {
    try {
      client.res.write(data);
    } catch {
      clients.delete(id);
    }
  }
}

export function connectedClientCount(): number {
  return clients.size;
}
