var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

class wsRoom {
  static { __name(this, "wsRoom"); }

  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.connections = new Set(); 
    this.sessions = new Map(); // deviceId -> WebSocket
  }

  // Метод для очистки ресурсов при отключении
  handleDisconnect(socket) {
    const wasRemoved = this.connections.delete(socket);
    if (socket.deviceId) {
      const wasInSessions = this.sessions.delete(socket.deviceId);
      // Если устройство реально удалено, уведомляем веб-клиентов
      if (wasInSessions || wasRemoved) {
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
      if (!conn.isDevice) {
        try {
          if (conn.readyState === 1) { // OPEN
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
          // ЗАЩИТА ОТ ЗАЛИПАНИЯ: Если ID уже есть, закрываем старую сессию
          const existing = this.sessions.get(data.deviceId);
          if (existing) {
            this.connections.delete(existing);
            try { existing.close(1000, "Replaced by new connection"); } catch(e){}
          }

          server.deviceId = data.deviceId;
          server.isDevice = true;
          this.sessions.set(data.deviceId, server);
          this.broadcastDeviceList();
          return;
        }

        // 2. Получение списка (только для веба)
        if (data.type === "getList") {
          server.send(JSON.stringify({
            type: "deviceList",
            devices: Array.from(this.sessions.keys())
          }));
          return;
        }

        // 3. Адресная команда
        if (data.targetId && data.command) {
          const target = this.sessions.get(data.targetId);
          if (target && target.readyState === 1) {
            target.send(data.command);
          } else if (target) {
            this.handleDisconnect(target);
          }
          return;
        }
      } catch (e) {
        // Обычный broadcast логов всем веб-клиентам
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

    // Обработка обрывов соединения
    server.addEventListener("close", () => this.handleDisconnect(server));
    server.addEventListener("error", () => this.handleDisconnect(server));

    return new Response(null, { status: 101, webSocket: client });
  }
}

// ЭКСПОРТ ПО УМОЛЧАНИЮ (ENTRYPOINT)
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
