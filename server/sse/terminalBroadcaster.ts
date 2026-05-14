import type { Response } from "express";

export interface SseEvent {
  type: "PRICE_UPDATE" | "TRADE_TICK" | "HEARTBEAT" | "SNAPSHOT" | "ORDER_TRIGGERED" | "ORDER_EXECUTED" | "ORDER_FAILED" | "ORDER_CANCELLED";
  data: Record<string, any>;
}

class TerminalBroadcaster {
  private clients = new Set<Response>();

  addClient(res: Response): () => void {
    this.clients.add(res);
    return () => {
      this.clients.delete(res);
    };
  }

  emit(event: SseEvent): void {
    if (this.clients.size === 0) return;
    const msg = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
    const dead: Response[] = [];
    for (const res of this.clients) {
      try {
        res.write(msg);
      } catch {
        dead.push(res);
      }
    }
    for (const r of dead) this.clients.delete(r);
  }

  get clientCount() {
    return this.clients.size;
  }
}

export const terminalBroadcaster = new TerminalBroadcaster();

let heartbeatInterval: NodeJS.Timeout | null = null;

export function startHeartbeat(intervalMs = 30000) {
  if (heartbeatInterval) return;
  heartbeatInterval = setInterval(() => {
    terminalBroadcaster.emit({ type: "HEARTBEAT", data: { ts: Date.now() } });
  }, intervalMs);
}
