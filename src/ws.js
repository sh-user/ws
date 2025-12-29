var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

var wsRoom = class {
  static { __name(this, "wsRoom"); }
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.connections = new Set();
    this.sessions = new Map(); // deviceId → websocket (только для плат)
  }

  // Рассылка списка только веб-клиентам
  broadcastDeviceList() {
    const listMessage = JSON.stringify({
      type: "deviceList",
      devices: Array.from(this.sessions.keys())
    });

    for (const conn of this.connections) {
      // Отправляем только помеченным веб-клиентам
      if (conn.isBrowser && !conn.isDevice) {
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

    // ПОМЕЧАЕМ КАК БРАУЗЕР ПО УМОЛЧАНИЮ
    server.isBrowser = true;
    server.isDevice = false;

    this.connections.add(server);

    server.addEventListener("message", (event) => {
      // Пинг-понг для keep-alive
      if (event.data === "ping") {
        server.send("pong");
        return;
      }

      try {
        const data = JSON.parse(event.data);

        // Явная регистрация браузера (наш клиент отправляет это при подключении)
        if (data.type === "register-browser") {
          server.isBrowser = true;
          server.isDevice = false; // на всякий случай
          return;
        }

        // Запрос списка устройств — только от браузеров
        if (data.type === "getList" && server.isBrowser) {
          server.send(JSON.stringify({
            type: "deviceList",
            devices: Array.from(this.sessions.keys())
          }));
          return;
        }

        // === ЗАПРЕЩАЕМ браузерам регистрироваться как платы ===
        if (data.type === "register") {
          // Если это браузер — игнорируем или закрываем
          if (server.isBrowser) {
            server.close(1008, "Browsers cannot register as devices");
            return;
          }
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
        // Не JSON — это обычные данные от платы (текст, сканы и т.д.)
        // Рассылаем только браузерам
        if (server.isDevice) {
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
    });

    // Регистрация платы — только после получения JSON с type: "register"
    server.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "register" && data.deviceId && !server.isBrowser) {
          // Только если не помечен как браузер
          server.deviceId = data.deviceId;
          server.isDevice = true;
          server.isBrowser = false; // на всякий случай
          this.sessions.set(data.deviceId, server);
          this.broadcastDeviceList();
        }
      } catch (_) {
        // Игнорируем не-JSON на этом этапе
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
