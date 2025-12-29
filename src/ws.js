var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

var wsRoom = class {
  static { __name(this, "wsRoom"); }
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.connections = new Set();
    this.sessions = new Map();

    // Запускаем проверку "живости" соединений плат
    this.startHeartbeat();
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

  // Проверка только плат — без ping/pong
  startHeartbeat() {
    setInterval(() => {
      for (const conn of this.connections) {
        if (conn.isDevice) {
          try {
            // Пробуем отправить пустое сообщение
            // Если соединение разорвано — бросит ошибку
            conn.send("");
          } catch (e) {
            // Соединение мертво — очищаем
            console.log("Heartbeat: detected disconnected device", conn.deviceId);
            this.connections.delete(conn);
            if (conn.deviceId) {
              this.sessions.delete(conn.deviceId);
              this.broadcastDeviceList();
            }
          }
        }
      }
    }, 15000); // каждые 15 секунд
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    server.accept();

    this.connections.add(server);

    server.addEventListener("message", (event) => {
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
        // Обычные данные от платы — рассылаем браузерам
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

    server.addEventListener("close", () => {
      this.connections.delete(server);
      if (server.deviceId && server.isDevice) {
        this.sessions.delete(server.deviceId);
        this.broadcastDeviceList();
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
