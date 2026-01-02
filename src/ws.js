var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

var wsRoom = class {
  static { __name(this, "wsRoom"); }
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.connections = new Set();
    this.sessions = new Map();
  }

  // Функция активной проверки всех устройств в списке
  async validateSessions() {
    for (const [deviceId, socket] of this.sessions.entries()) {
      // 1. Проверка базового статуса
      if (socket.readyState !== 1) { // 1 = OPEN
        this.sessions.delete(deviceId);
        this.connections.delete(socket);
        continue;
      }

      // 2. Активная попытка "простучать" сокет.
      // Если плата отключена, попытка записи часто провоцирует смену readyState
      try {
        socket.send(""); // Отправляем пустую строку (минимальный трафик)
      } catch (e) {
        this.sessions.delete(deviceId);
        this.connections.delete(socket);
      }
    }
  }

  broadcastDeviceList() {
    const listMessage = JSON.stringify({
      type: "deviceList",
      devices: Array.from(this.sessions.keys())
    });
    
    for (const conn of this.connections) {
      if (!conn.isDevice && conn.readyState === 1) {
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
    
    server.isDevice = false;

    server.addEventListener("message", async (event) => {
      try {
        const data = JSON.parse(event.data);

        // 1. Регистрация платы
        if (data.type === "register" && data.deviceId) {
          server.deviceId = data.deviceId;
          server.isDevice = true; 
          this.sessions.set(data.deviceId, server);
          this.broadcastDeviceList();
          return;
        }

        // 2. Запрос списка с предварительной проверкой "живости"
        if (data.type === "getList") {
          await this.validateSessions(); // Сначала чистим мертвых
          server.send(JSON.stringify({
            type: "deviceList",
            devices: Array.from(this.sessions.keys())
          }));
          return;
        }

        // 3. Адресная команда
        if (data.targetId && data.command) {
          const targetSocket = this.sessions.get(data.targetId);
          if (targetSocket) {
            try {
              targetSocket.send(data.command);
            } catch (e) {
              // Если отправить не удалось, удаляем устройство
              this.sessions.delete(data.targetId);
              this.broadcastDeviceList();
            }
          }
          return;
        }
      } catch (e) {
        // Обычный broadcast (только для людей)
        for (const conn of this.connections) {
          if (conn !== server && !conn.isDevice && conn.readyState === 1) {
            conn.send(event.data);
          }
        }
      }
    });

    server.addEventListener("close", () => {
      this.connections.delete(server);
      if (server.deviceId) {
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
