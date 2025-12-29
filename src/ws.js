var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

var wsRoom = class {
  static { __name(this, "wsRoom"); }
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.connections = new Set();
    this.sessions = new Map();
    this.pingTimeouts = new Map(); // новый Map для таймаутов
  }

  broadcastDeviceList() {
    const listMessage = JSON.stringify({
      type: "deviceList",
      devices: Array.from(this.sessions.keys())
    });

    for (const conn of this.connections) {
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

    // Новая функция: проверка жизни соединения
    const schedulePing = () => {
      const timeout = setTimeout(() => {
        try {
          server.send("ping");
        } catch (e) {
          // Если send бросил ошибку — соединение уже мёртвое
          cleanup();
        }
      }, 10000); // пинг каждые 10 секунд

      this.pingTimeouts.set(server, timeout);
    };

    const cleanup = () => {
      clearTimeout(this.pingTimeouts.get(server));
      this.pingTimeouts.delete(server);
      this.connections.delete(server);
      if (server.deviceId && server.isDevice) {
        this.sessions.delete(server.deviceId);
        this.broadcastDeviceList();
      }
    };

    // Начинаем слать пинги сразу
    schedulePing();

    server.addEventListener("message", (event) => {
      if (event.data === "ping") {
        server.send("pong");
        return;
      }
      if (event.data === "pong") {
        // Получили pong — планируем следующий пинг
        clearTimeout(this.pingTimeouts.get(server));
        schedulePing();
        return;
      }

      try {
        const data = JSON.parse(event.data);

        if (data.type === "register" && data.deviceId) {
          server.deviceId = data.deviceId;
          server.isDevice = true;
          this.sessions.set(data.deviceId, server);
          this.broadcastDeviceList();
          return;
        }

        if (data.type === "getList") {
          server.send(JSON.stringify({
            type: "deviceList",
            devices: Array.from(this.sessions.keys())
          }));
          return;
        }

        if (data.targetId && data.command) {
          const targetSocket = this.sessions.get(data.targetId);
          if (targetSocket) {
            targetSocket.send(data.command);
          }
          return;
        }

      } catch (e) {
        // Данные от платы — рассылаем браузерам
        if (server.isDevice) {
          for (const conn of this.connections) {
            if (!conn.isDevice) {
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

    server.addEventListener("close", cleanup);
    server.addEventListener("error", cleanup);

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
