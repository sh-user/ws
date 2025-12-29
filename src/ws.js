var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

var wsRoom = class {
  static { __name(this, "wsRoom"); }
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.connections = new Set();     // все подключения
    this.sessions = new Map();        // deviceId → websocket (только платы)
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

    // По умолчанию считаем браузером — безопасность превыше всего
    server.isBrowser = true;
    server.isDevice = false;

    this.connections.add(server);

    server.addEventListener("message", async (event) => {
      // Keep-alive пинг
      if (event.data === "ping") {
        server.send("pong");
        return;
      }

      // Попробуем распарсить как JSON
      let parsed = null;
      try {
        parsed = JSON.parse(event.data);
      } catch (e) {
        // Не JSON → это данные от платы (скан, лог и т.д.)
        if (server.isDevice) {
          // Рассылаем всем браузерам
          for (const conn of this.connections) {
            if (conn.isBrowser && conn !== server) {
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

      // === JSON-обработка ===

      // Браузер явно подтверждает, что он браузер (наш клиент это делает)
      if (parsed.type === "register-browser") {
        server.isBrowser = true;
        server.isDevice = false;
        return;
      }

      // Запрос списка устройств — только от браузеров
      if (parsed.type === "getList" && server.isBrowser) {
        server.send(JSON.stringify({
          type: "deviceList",
          devices: Array.from(this.sessions.keys())
        }));
        return;
      }

      // Регистрация платы — разрешена ТОЛЬКО если ещё не помечен как браузер
      if (parsed.type === "register" && parsed.deviceId && !server.isBrowser) {
        server.deviceId = parsed.deviceId;
        server.isDevice = true;
        server.isBrowser = false;  // снимаем флаг браузера
        this.sessions.set(parsed.deviceId, server);
        this.broadcastDeviceList();
        return;
      }

      // Если браузер пытается зарегистрироваться как плата — закрываем соединение
      if (parsed.type === "register" && server.isBrowser) {
        server.close(1008, "Browsers cannot register as devices");
        return;
      }

      // Команда от браузера к конкретной плате
      if (parsed.targetId && parsed.command && server.isBrowser) {
        const target = this.sessions.get(parsed.targetId);
        if (target) {
          try {
            target.send(parsed.command);
          } catch (e) {
            // если плата отвалилась — удаляем из сессий
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

    server.addEventListener("error", () => {
      // Аналогично close
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
