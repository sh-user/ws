var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

var wsRoom = class {
  static { __name(this, "wsRoom"); }
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.connections = new Set();
    this.sessions = new Map();
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    this.connections.add(server);
    server.isDevice = false;

    server.addEventListener("message", async (event) => {
      // ПЛАТА ОТВЕТИЛА: фиксируем время последнего ответа
      server.lastActive = Date.now();

      try {
        const data = JSON.parse(event.data);

        // 1. РЕГИСТРАЦИЯ ПЛАТЫ
        if (data.type === "register" && data.deviceId) {
          server.deviceId = data.deviceId;
          server.isDevice = true;
          this.sessions.set(data.deviceId, server);
          return;
        }

        // 2. ЗАПРОС СПИСКА (С ПРОВЕРКОЙ)
        if (data.type === "getList") {
          const now = Date.now();
          
          // Рассылаем запрос на проверку всем устройствам
          for (const [id, socket] of this.sessions.entries()) {
            try {
              socket.send("?"); // Просим плату отозваться любым сообщением
            } catch(e) {}
          }

          // Даем платам 300мс на ответ
          await new Promise(r => setTimeout(r, 300));

          const activeDevices = [];
          for (const [id, socket] of this.sessions.entries()) {
            // Если плата ответила в последние 500мс и сокет открыт
            if (socket.readyState === 1 && (Date.now() - (socket.lastActive || 0) < 500)) {
              activeDevices.push(id);
            } else {
              this.sessions.delete(id);
              this.connections.delete(socket);
            }
          }

          server.send(JSON.stringify({
            type: "deviceList",
            devices: activeDevices
          }));
          return;
        }

        // 3. КОМАНДЫ
        if (data.targetId && data.command) {
          const target = this.sessions.get(data.targetId);
          if (target && target.readyState === 1) {
            target.send(data.command);
          }
          return;
        }

      } catch (e) {
        // Обычный чат/broadcast
        for (const conn of this.connections) {
          if (conn !== server && !conn.isDevice && conn.readyState === 1) {
            conn.send(event.data);
          }
        }
      }
    });

    server.addEventListener("close", () => {
      this.connections.delete(server);
      if (server.deviceId) this.sessions.delete(server.deviceId);
    });

    return new Response(null, { status: 101, webSocket: client });
  }
};

var ws_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const roomId = url.searchParams.get("room") || "default";
    const id = env.WS_ROOM.idFromName(roomId);
    const stub = env.WS_ROOM.get(id);
    return stub.fetch(request);
  }
};

export { ws_default as default, wsRoom };
