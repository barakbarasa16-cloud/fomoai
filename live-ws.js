import express from "express";
import { WebSocket, WebSocketServer } from "ws";

// Attach a WebSocket bridge to the same HTTP server created by Express.
// The browser connects to /ws; the server connects to Birdeye's low-latency
// Solana price stream when BIRDEYE_API_KEY is configured on Render.
if (!express.application.__fomoRealtimePatched) {
  const originalListen = express.application.listen;
  express.application.listen = function (...args) {
    const server = originalListen.apply(this, args);
    const wss = new WebSocketServer({ server, path: "/ws" });

    wss.on("connection", (client) => {
      let upstream = null;
      let reconnectTimer = null;
      let pingTimer = null;
      let address = "";
      let closed = false;

      const send = (payload) => {
        if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(payload));
      };

      const cleanupUpstream = () => {
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
        if (upstream) {
          try { upstream.removeAllListeners(); upstream.close(); } catch {}
          upstream = null;
        }
      };

      const connect = () => {
        if (closed || !address) return;
        const key = process.env.BIRDEYE_API_KEY;
        if (!key) {
          send({ type: "STATUS", connected: false, provider: "fallback", message: "BIRDEYE_API_KEY is not configured; using REST fallback." });
          return;
        }

        cleanupUpstream();
        const url = `wss://public-api.birdeye.so/socket/solana?x-api-key=${encodeURIComponent(key)}`;
        try {
          upstream = new WebSocket(url, "echo-protocol", {
            headers: { Origin: "ws://public-api.birdeye.so" },
            handshakeTimeout: 10000
          });
        } catch (err) {
          send({ type: "STATUS", connected: false, provider: "birdeye", message: "WebSocket connection failed." });
          return;
        }

        upstream.on("open", () => {
          if (closed || !upstream) return;
          upstream.send(JSON.stringify({
            type: "SUBSCRIBE_PRICE",
            data: { queryType: "simple", chartType: "1m", address, currency: "usd", mode: "raw" }
          }));
          send({ type: "STATUS", connected: true, provider: "birdeye", address });
          pingTimer = setInterval(() => {
            try { if (upstream?.readyState === WebSocket.OPEN) upstream.ping(); } catch {}
          }, 20000);
        });

        upstream.on("message", (raw) => {
          try {
            const msg = JSON.parse(raw.toString());
            if (msg?.type === "PRICE_DATA") send({ type: "PRICE_DATA", data: msg.data || msg });
            else if (msg?.type === "ERROR") send({ type: "ERROR", message: msg.message || "Birdeye stream error" });
          } catch {}
        });

        upstream.on("error", () => {
          send({ type: "STATUS", connected: false, provider: "birdeye", message: "Live provider connection lost; reconnecting." });
        });

        upstream.on("close", () => {
          if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
          if (!closed && address) {
            reconnectTimer = setTimeout(connect, 1500);
          }
        });
      };

      client.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg?.action === "subscribe") {
            const next = String(msg.address || "").trim();
            if (!/^[1-9A-HJ-NP-Za-km-z]{32,50}$/.test(next)) {
              send({ type: "ERROR", message: "Invalid Solana token address." });
              return;
            }
            address = next;
            connect();
          }
          if (msg?.action === "unsubscribe") {
            address = "";
            cleanupUpstream();
            send({ type: "STATUS", connected: false, provider: "none" });
          }
        } catch {
          send({ type: "ERROR", message: "Invalid WebSocket message." });
        }
      });

      client.on("close", () => {
        closed = true;
        cleanupUpstream();
      });
      client.on("error", () => {
        closed = true;
        cleanupUpstream();
      });

      send({ type: "READY", provider: process.env.BIRDEYE_API_KEY ? "birdeye" : "fallback" });
    });

    return server;
  };
  express.application.__fomoRealtimePatched = true;
}
