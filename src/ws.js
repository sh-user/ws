export class wsRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.connections = new Map(); // connectionId -> WebSocket
  }

  // Обработка входящих запросов
  async fetch(req) {
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 400 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    const id = crypto.randomUUID();

    server.accept();
    this.connections.set(id, server);

    server.addEventListener("message", (event) => {
      this.broadcast(event.data, id);
    });

    server.addEventListener("close", () => {
      this.connections.delete(id);
    });

    server.addEventListener("error", () => {
      this.connections.delete(id);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(message, excludeId) {
    for (const [id, socket] of this.connections) {
      if (id !== excludeId && socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(message);
        } catch {
          socket.close(1011, "Broadcast error");
        }
      }
    }
  }
}
