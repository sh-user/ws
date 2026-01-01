var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// --- DURABLE OBJECT: Класс для управления комнатой и сокетами ---
class wsRoom {
  static { __name(this, "wsRoom"); }

  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.connections = new Set(); // Все подключения (и браузеры, и платы)
    this.sessions = new Map();    // Только зарегистрированные устройства (deviceId -> WebSocket)
  }

  // Централизованный метод для удаления "зависших" или закрытых соединений
  handleDisconnect(socket) {
    const wasInConnections = this.connections.delete(socket);
    
    if (socket.deviceId) {
      const wasInSessions = this.sessions.delete(socket.deviceId);
      // Если устройство реально было в списке и удалилось — рассылаем новый список
      if (wasInSessions || wasInConnections) {
        this.broadcastDeviceList();
      }
    }
  }

  // Рассылка списка устройств только веб-клиентам
  broadcastDeviceList() {
    const listMessage = JSON.stringify({
      type: "deviceList",
      devices: Array.from(this.sessions.keys())
    });

    for (const conn of this.connections) {
      // Отправляем только если это веб-клиент (не плата)
      if (!conn.isDevice) {
        try {
          if (conn.readyState === 1) { // 1 = OPEN
            conn.send(listMessage);
          } else {
            this.handleDisconnect(conn);
          }
        } catch (e) {
          this.handleDisconnect(conn);
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

        // 1. Регистрация устройства
        if (data.type === "register" && data.deviceId) {
          server.deviceId = data.deviceId;
          server.isDevice = true;
          this.sessions.set(data.deviceId, server);
          this.broadcastDeviceList();
          return;
        }

        // 2. Запрос списка устройств
        if (data.type === "getList") {
          server.send(JSON.stringify({
            type: "deviceList",
            devices: Array.from(this.sessions.keys())
          }));
          return;
        }

        // 3. Адресная команда (Браузер -> Плата)
        if (data.targetId && data.command) {
          const targetSocket = this.sessions.get(data.targetId);
          if (targetSocket && targetSocket.readyState === 1) {
            targetSocket.send(data.command);
          } else if (targetSocket) {
            // Если сокет в Map есть, но он не OPEN — удаляем
            this.handleDisconnect(targetSocket);
          }
          return;
        }
      } catch (e) {
        // Если пришел не JSON — обычный broadcast (логи от плат веб-клиентам)
        for (const conn of this.connections) {
          if (conn !== server && !conn.isDevice) {
            try {
              conn.send(event.data);
            } catch (err) {
              this.handleDisconnect(conn);
            }
          }
        }
      }
    });

    // Важнейшие события для "выбрасывания" устройств
    server.addEventListener("close", () => this.handleDisconnect(server));
    server.addEventListener("error", () => this.handleDisconnect(server));

    return new Response(null, { status: 101, webSocket: client });
  }
}
