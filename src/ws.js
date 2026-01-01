var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// --- Класс Durable Object для управления комнатой ---
class wsRoom {
  static { __name(this, "wsRoom"); }

  constructor(state, env) {
    this.state = state;
    this.env = env;
    // Храним все активные соединения
    this.connections = new Set();
    // Храним только устройства: Map(deviceId => WebSocket)
    this.sessions = new Map();
  }

  // Метод для очистки ресурсов при отключении
  handleDisconnect(socket) {
    this.connections.delete(socket);
    
    if (socket.deviceId) {
      console.log(`Device disconnected: ${socket.deviceId}`);
      this.sessions.delete(socket.deviceId);
      // После удаления устройства обновляем список у веб-клиентов
      this.broadcastDeviceList();
    }
  }

  // Рассылка списка активных устройств только веб-клиентам
  broadcastDeviceList() {
    const listMessage = JSON.stringify({
      type: "deviceList",
      devices: Array.from(this.sessions.keys())
    });

    for (const conn of this.connections) {
      // Отправляем только если это веб-интерфейс (не устройство)
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

    // Важно вызвать accept() до добавления обработчиков
    server.accept();
    this.connections.add(server);

    server.addEventListener("message", (event) => {
      // 0. Heartbeat (Пинг-понг для поддержания жизни)
      if (event.data === "ping") {
        server.send("pong");
        return;
      }

      try {
        const data = JSON.parse(event.data);

        // 1. Регистрация устройства (например, RP2040)
        if (data.type === "register" && data.deviceId) {
          server.deviceId = data.deviceId;
          server.isDevice = true;
          this.sessions.set(data.deviceId, server);
          
          console.log(`Device registered: ${data.deviceId}`);
          this.broadcastDeviceList();
          return;
        }

        // 2. Запрос списка вручную (от веб-клиента)
        if (data.type === "getList") {
          server.send(JSON.stringify({
            type: "deviceList",
            devices: Array.from(this.sessions.keys())
          }));
          return;
        }

        // 3. Адресная команда (от веб-клиента к конкретному устройству)
        if (data.targetId && data.command) {
          const targetSocket = this.sessions.get(data.targetId);
          if (targetSocket && targetSocket.readyState === 1) {
            // Пересылаем команду устройству
            targetSocket.send(typeof data.command === 'string' ? data.command : JSON.stringify(data.command));
          } else if (targetSocket) {
            // Если сокет в списке есть, но мертв — удаляем
            this.handleDisconnect(targetSocket);
          }
          return;
        }

      } catch (e) {
        // Если пришел не JSON — делаем обычный broadcast всем веб-клиентам
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

    // Обработка закрытия соединения
    server.addEventListener("close", (event) => {
      console.log("WebSocket closed. Code:", event.code);
      this.handleDisconnect(server);
    });

    // Обработка ошибок соединения (важно для "выбрасывания")
    server.addEventListener("error", () => {
      console.error("WebSocket error occurred");
      this.handleDisconnect(server);
    });

    return new Response(null, { status: 101, webSocket: client });
  }
}

// --- Основной обработчик Worker ---
var ws_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Получаем имя комнаты из URL, например ?room=my-home
    const roomId = url.searchParams.get("room") || "default";
    const id = env.WS_ROOM.idFromName(roomId);
    const stub = env.WS_ROOM.get(id);

    return stub.fetch(request);
  }
};

export { ws_default as default, wsRoom };
