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

  broadcastDeviceList() {
    const listMessage = JSON.stringify({
      type: "deviceList",
      devices: Array.from(this.sessions.keys())
    });

    for (const conn of this.connections) {
      if (conn.isBrowser) {
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

    // Изначально НЕ помечаем ни как браузер, ни как устройство
    server.isBrowser = false;
    server.isDevice = false;

    this.connections.add(server);

    server.addEventListener("message", (event) => {
      if (event.data === "ping") {
        server.send("pong");
        return;
      }

      let parsed = null;
      try {
        parsed = JSON.parse(event.data);
      } catch (e) {
        // Не JSON — данные от платы
        if (server.isDevice) {
          for (const conn of this.connections) {
            if (conn.isBrowser) {
              try {
                conn.send(event.data);
              } catch (_) {
                this.connections.delete(conn);
              }
            }
          }
        }
        return;
      }

      // === JSON-сообщения ===

      // Веб-клиент явно объявляет себя браузером
      if (parsed.type === "register-browser") {
        server.isBrowser = true;
        // НЕ устанавливаем isDevice = false — если это была плата, не мешаем
        return;
      }

      // Запрос списка — только от браузеров
      if (parsed.type === "getList" && server.isBrowser) {
        server.send(JSON.stringify({
          type: "deviceList",
          devices: Array.from(this.sessions.keys())
        }));
        return;
      }

      // Регистрация платы — разрешена всегда, если ещё не зарегистрирована
      if (parsed.type === "register" && parsed.deviceId) {
        // Защита: если уже помечен как браузер — запрещаем
        if (server.isBrowser) {
          server.close(1008, "Browsers cannot register as devices");
          return;
        }

        // Регистрируем плату
        if (server.isDevice && server.deviceId === parsed.deviceId) {
          // Уже зарегистрирована с тем же ID — ок
          return;
        }

        // Если была зарегистрирована под другим ID — удаляем старую
        if (server.isDevice && server.deviceId) {
          this.sessions.delete(server.deviceId);
        }

        server.deviceId = parsed.deviceId;
        server.isDevice = true;
        server.isBrowser = false;

        this.sessions.set(parsed.deviceId, server);
        this.broadcastDeviceList();
        return;
      }

      // Команда от браузера к плате
      if (parsed.targetId && parsed.command && server.isBrowser) {
        const target = this.sessions.get(parsed.targetId);
        if (target) {
          try {
            target.send(parsed.command);
          } catch (e) {
            this.sessions.delete(parsed.targetId);
            this.broadcastDeviceList();
          }
        }
        return;
      }
    });

    server.addEventListener("close", () => {
      this.connections.delete(server);
      if (server.isDevice && server.deviceId) {
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
