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
  // Рассылка списка только веб-клиентам
  broadcastDeviceList() {
    const listMessage = JSON.stringify({
      type: "deviceList",
      devices: Array.from(this.sessions.keys())
    });
   
    for (const conn of this.connections) {
      // Отправляем только если это НЕ плата
      if (!conn.isDevice) {
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
    server.addEventListener("message", (event) => {
      if (event.data === "ping") {
        server.send("pong");
        return;
      }
      try {
        const data = JSON.parse(event.data);
        // 1. Регистрация платы (RP2040)
        if (data.type === "register" && data.deviceId) {
          server.deviceId = data.deviceId;
          server.isDevice = true; // ПОМЕТКА: это устройство
          this.sessions.set(data.deviceId, server);
         
          this.broadcastDeviceList();
          return;
        }
        // 2. Запрос списка (только для веб-клиентов)
        if (data.type === "getList") {

  // 1. Проходим по всем сохраненным сессиям [cite: 3]
  for (const [deviceId, socket] of this.sessions.entries()) {
    try {
      // Попытка отправить системный ping. 
      // Если соединение реально разорвано, вызов .send() или обращение к сокету 
      // заставит систему обновить readyState.
      socket.send(JSON.stringify({ type: "internal_ping" })); 
    } catch (e) {
      // Если отправка не удалась, сразу удаляем [cite: 4]
      this.sessions.delete(deviceId);
      this.connections.delete(socket);
    }
  }
 // 3. Формируем список только из тех, кто остался в статусе OPEN (1) 
  const activeDevices = Array.from(this.sessions.entries())
    .filter(([_, socket]) => socket.readyState === 1)
    .map(([id, _]) => id);
          
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
            targetSocket.send(data.command);
          }
          return;
        }
      } catch (e) {
        // Обычный broadcast (только для тех, кто не помечен как устройство)
        for (const conn of this.connections) {
          if (conn !== server && !conn.isDevice) {
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
