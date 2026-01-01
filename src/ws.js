var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

export class wsRoom {
  static { __name(this, "wsRoom"); }

  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.connections = new Set(); 
    this.sessions = new Map(); // deviceId -> WebSocket
  }

  // Удаление сокета и уведомление остальных
  handleDisconnect(socket) {
    this.connections.delete(socket);
    if (socket.deviceId) {
      this.sessions.delete(socket.deviceId);
      this.broadcastDeviceList();
    }
  }

  // Рассылка списка активных устройств
  broadcastDeviceList() {
    const listMessage = JSON.stringify({
      type: "deviceList",
      devices: Array.from(this.sessions.keys())
    });

    for (const conn of this.connections) {
      // Отправляем только веб-клиентам (у которых isDevice не true)
      if (!conn.isDevice && conn.readyState === 1) {
        try {
          conn.send(listMessage);
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

        // 1. Когда заходит плата (RP2040)
        if (data.type === "register" && data.deviceId) {
          // Если старая сессия этой платы еще висит — удаляем её
          const oldSocket = this.sessions.get(data.deviceId);
          if (oldSocket) {
            this.connections.delete(oldSocket);
            try { oldSocket.close(); } catch(e){}
          }

          server.deviceId = data.deviceId;
          server.isDevice = true;
          this.sessions.set(data.deviceId, server);
          this.broadcastDeviceList(); // Сразу обновляем список у всех браузеров
          return;
        }

        // 2. Когда браузер запрашивает список (при загрузке страницы)
        if (data.type === "getList") {
          server.send(JSON.stringify({
            type: "deviceList",
            devices: Array.from(this.sessions.keys())
          }));
          return;
        }

        // 3. Команды от браузера к плате
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
        // Обычная пересылка текстовых логов от плат в браузеры
        for (const conn of this.connections) {
          if (conn !== server && !conn.isDevice && conn.readyState === 1) {
            try { conn.send(event.data); } catch (err) { this.handleDisconnect(conn); }
          }
        }
      }
    });

    server.addEventListener("close", () => this.handleDisconnect(server));
    server.addEventListener("error", () => this.handleDisconnect(server));

    return new Response(null, { status: 101, webSocket: client });
  }
}

// Прокси-воркер для перенаправления запросов в Durable Object
var ws_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const roomId = url.searchParams.get("room") || "default";
    const id = env.WS_ROOM.idFromName(roomId);
    const stub = env.WS_ROOM.get(id);
    return stub.fetch(request);
  }
};

export { ws_default as default };
