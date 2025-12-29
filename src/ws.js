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

  broadcastDeviceList() {
    const listMessage = JSON.stringify({
      type: "deviceList",
      devices: Array.from(this.sessions.keys())
    });

    for (const conn of this.connections) {
      // Исправление 1: отправляем ТОЛЬКО тем, у кого НЕТ isDevice (т.е. браузерам)
      // Было: if (!conn.isDevice)
      // Остаётся то же, но с защитой от undefined
      if (!conn.isDevice) {
        try {
          conn.send(listMessage);
        } catch (e) {
          this.connections.delete(conn);
        }
      }
    }
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    server.accept();

    this.connections.add(server);

    server.addEventListener("message", (event) => {
      if (event.data === "ping") {
        server.send("pong");
        return;
      }

      try {
        const data = JSON.parse(event.data);

        // Регистрация платы
        if (data.type === "register" && data.deviceId) {
          server.deviceId = data.deviceId;
          server.isDevice = true;
          this.sessions.set(data.deviceId, server);
          this.broadcastDeviceList();  // обновляем список при подключении
          return;
        }

        // Запрос списка от браузера
        if (data.type === "getList") {
          server.send(JSON.stringify({
            type: "deviceList",
            devices: Array.from(this.sessions.keys())
          }));
          return;
        }

        // Команда от браузера к плате
        if (data.targetId && data.command) {
          const targetSocket = this.sessions.get(data.targetId);
          if (targetSocket) {
            targetSocket.send(data.command);
          }
          return;
        }

      } catch (e) {
        // Исправление 2: данные от платы рассылаем ТОЛЬКО браузерам
        // Было: if (conn !== server && !conn.isDevice)
        // Стало: только !conn.isDevice (и conn !== server не нужен — плата себе не шлёт)
        if (server.isDevice) {
          for (const conn of this.connections) {
            if (!conn.isDevice) {  // только браузерам
              try {
                conn.send(event.data);
              } catch (_) {
                this.connections.delete(conn);
              }
            }
          }
        }
      }
    });

    server.addEventListener("close", () => {
      this.connections.delete(server);
      if (server.deviceId && server.isDevice) {
        this.sessions.delete(server.deviceId);
        this.broadcastDeviceList();  // ← обновляем список при отключении
      }
    });

    return new Response(null, { status: 101, webSocket: client });
  }
};

var ws_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const roomId = url.searchParams.get("room") || "default";
    const id = env.WS_ROOM.idFromName(roomId);
    const stub = env.WS_ROOM.get(id);
    return stub.fetch(request);
  }
};

export { ws_default as default, wsRoom };
