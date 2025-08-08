export class wsRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.connections = new Set();
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const [client, server] = Object.values(new WebSocketPair());

    server.accept();
    this.connections.add(server);

    server.addEventListener("message", (event) => {
      console.log("Received message:", event.data); // Отладка
      if (event.data === "ping") {
        console.log("Sending pong");
        server.send("pong"); // Ответ на текстовое сообщение "ping"
      } else {
        // Рассылка сообщения всем остальным клиентам
        for (const conn of this.connections) {
          if (conn !== server) {
            conn.send(event.data);
          }
        }
      }
    });

    server.addEventListener("close", () => {
      console.log("Connection closed"); // Отладка
      this.connections.delete(server);
    });

    return new Response(null, { status: 101, webSocket: client });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const roomId = url.searchParams.get("room") || "default";

    const id = env.WS_ROOM.idFromName(roomId);
    const stub = env.WS_ROOM.get(id);

    return stub.fetch(request);
  }
};
