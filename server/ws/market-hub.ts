import type { WebSocket } from "ws";

type Channel = "ticker" | "trades" | `asset:${number}`;

type ClientState = {
  ws: WebSocket;
  subs: Set<Channel>;
};

function safeSend(ws: WebSocket, payload: any) {
  try {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
  } catch { /* ignore */ }
}

class MarketHub {
  private clients = new Set<ClientState>();

  addClient(ws: WebSocket) {
    const state: ClientState = { ws, subs: new Set() };
    this.clients.add(state);

    safeSend(ws, { type: "hello", data: { ok: true } });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw || ""));
        if (msg?.type === "subscribe" && typeof msg.channel === "string") {
          state.subs.add(msg.channel as Channel);
          safeSend(ws, { type: "subscribed", data: { channel: msg.channel } });
        }
        if (msg?.type === "unsubscribe" && typeof msg.channel === "string") {
          state.subs.delete(msg.channel as Channel);
          safeSend(ws, { type: "unsubscribed", data: { channel: msg.channel } });
        }
      } catch {
        safeSend(ws, { type: "error", data: { message: "Invalid message" } });
      }
    });

    ws.on("close", () => {
      this.clients.delete(state);
    });

    return state;
  }

  publish(channel: Channel, event: any) {
    const payload = { channel, ...event };
    for (const c of this.clients) {
      if (c.subs.has(channel)) safeSend(c.ws, payload);
    }
  }

  publishTicker(event: any) {
    this.publish("ticker", event);
  }

  publishTrades(event: any) {
    this.publish("trades", event);
  }

  publishAsset(assetId: number, event: any) {
    this.publish(`asset:${assetId}`, event);
  }
}

export const marketHub = new MarketHub();
