var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

export class wsRoom {
  static { __name(this, "wsRoom"); }

  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.connections = new Set(); // Все активные сокеты
    this.sessions = new Map();    // deviceId -> WebSocket (только платы)
  }

  // Метод для удаления устройства из всех списков
  handleDisconnect(socket) {
    const wasRemoved = this.connections.delete(socket);
    if (socket.deviceId) {
      const wasInSessions = this.sessions.delete(socket.deviceId);
      // Если устройство реально удалено, уведомляем веб-интерфейсы
      if (wasInSessions || wasRemoved) {
        this.broadcastDeviceList();
      }
    }
  }

  // Рассылка актуального списка устройств всем веб-клиентам
  broadcastDeviceList() {
    const listMessage = JSON.stringify({
      type: "deviceList",
      devices: Array.from(this.sessions.keys())
    });

    for (const conn of this.connections) {
      // Отправляем список только тем, кто НЕ является устройством (т.е. браузерам)
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

        // 1. РЕГИСТРАЦИЯ УСТРОЙСТВА (платы)
        if (data.type === "register" && data.deviceId) {
          // ПРОВЕРКА НА ДУБЛИКАТ: Если плата переподключилась, удаляем старый "призрачный" сокет
          const existing = this.sessions.get(data.deviceId);
          if (existing) {
            this.connections.delete(existing);
            try { existing.close(1000, "Replaced by new connection"); } catch(e) {}
          }

          server.deviceId = data.deviceId;
          server.isDevice = true; // Пометка, что это плата
          this.sessions.set(data.deviceId, server);
          
          this.broadcastDeviceList();
          return;
        }

        // 2. ПОЛУЧЕНИЕ СПИСКА (для браузера)
        if (data.type === "getList") {
          server.send(JSON.stringify({
            type: "deviceList",
            devices: Array.from(this.sessions.keys())
          }));
          return;
        }

        // 3. АДРЕСНАЯ ПЕРЕСЫЛКА (Команда от браузера к плате)
        if (data.targetId && data.command) {
          const targetSocket = this.sessions.get(data.targetId);
          if (targetSocket && targetSocket.readyState === 1) {
            targetSocket.send(data.command);
          } else if (targetSocket) {
            this.handleDisconnect(targetSocket);
          }
          return;
        }
      } catch (e) {
        // Если пришел не JSON (например, логи от платы), пересылаем всем веб-клиентам
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

    // Мгновенная очистка при закрытии или ошибке
    server.addEventListener("close", () => this.handleDisconnect(server));
    server.addEventListener("error", () => this.handleDisconnect(server));

    return new Response(null, { status: 101, webSocket: client });
  }
}
