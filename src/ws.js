var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

var wsRoom = class {
  static { __name(this, "wsRoom"); }
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.connections = new Set();
    this.sessions = new Map(); // deviceId → websocket (платы)
  }

  // Рассылка списка только браузерам
  broadcastDeviceList() {
    const listMessage = JSON.stringify({
      type: "deviceList",
      devices: Array.from(this.sessions.keys())
    });

    for (const conn of this.connections) {
      if (conn.isBrowser) {  // Только явно помеченным браузерам
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

    // Изначально ничего не помечаем
    server.isBrowser = false;
    server.isDevice = false;

    this.connections.add(server);

    server.addEventListener("message", (event) => {
      if (event.data === "ping") {
        server.send("pong");
        return;
      }

      try {
        const data = JSON.parse(event.data);

        // Веб-клиент объявляет себя браузером
        if (data.type === "register-browser") {
          server.isBrowser = true;
          return;
        }

        // Регистрация платы
        if (data.type === "register" && data.deviceId) {
          server.deviceId = data.deviceId;
          server.isDevice = true;
          // НЕ устанавливаем isBrowser = true
          this.sessions.set(data.deviceId, server);
          this.broadcastDeviceList();
          return;
        }

        // Запрос списка — только от браузеров
        if (data.type === "getList" && server.isBrowser) {
          server.send(JSON.stringify({
            type: "deviceList",
            devices: Array.from(this.sessions.keys())
          }));
          return;
        }

        // Адресная команда от браузера к плате
        if (data.targetId && data.command && server.isBrowser) {
          const targetSocket = this.sessions.get(data.targetId);
          if (targetSocket) {
            targetSocket.send(data.command);
          }
          return;
        }

      } catch (e) {
        // Это обычные данные от платы (скан, лог, file и т.д.)
        // Рассылаем ТОЛЬКО браузерам
        if (server.isDevice) {
          for (const conn of this.connections) {
            if (conn.isBrowser) {  // Только браузерам!
              try {
                conn.send(event.data);
              } catch (_) {
                this.connections.delete(conn);
              }
            }
          }
        }
        // Если сообщение не от платы — игнорируем (защита)
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
