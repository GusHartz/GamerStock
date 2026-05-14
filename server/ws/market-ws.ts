import { WebSocketServer } from "ws";
import type { Server as HttpServer } from "http";
import { marketHub } from "./market-hub";

export function attachMarketWs(httpServer: HttpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws/market" });

  wss.on("connection", (ws) => {
    marketHub.addClient(ws);
  });

  console.log("[WS] Market WS attached at /ws/market");
}
