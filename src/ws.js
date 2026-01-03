var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// --- КЛАСС DURABLE OBJECT ---
class wsRoom {
  static { __name(this, "wsRoom"); }
  
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.connections = new Set(); 
    this.sessions = new Map();    
  }

  // Фоновая очистка и проверка связи
  async alarm() {
    const now = Date.now();
    let hasChanges = false;

    for (const [id, socket] of this.sessions.entries()) {
      if (socket.readyState !== 1) {
        this.sessions.delete(id);
        this.connections.delete(socket);
        hasChanges = true;
        continue;
      }

      // Если плата молчит > 40 сек — удаляем
      if (now - (socket.lastActive || 0) > 40000) {
        socket.close(1011, "Heartbeat timeout");
        this.sessions.delete(id);
        this.connections.delete(socket);
        hasChanges = true;
      } else {
        try { socket.send("?"); } catch (e) {}
      }
    }

    if (hasChanges) this.broadcastDeviceList();
    await this.state.storage.setAlarm(Date.now() + 20000);
  }

  broadcastDeviceList() {
    const list = JSON.stringify({
      type: "deviceList",
      devices: Array.from(this.sessions.keys())
    });
    for (const conn of this.connections) {
      if (!conn.isDevice && conn.readyState === 1) {
        try { conn.send(list); } catch (e) {}
      }
    }
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WS", { status: 426 });

    const [client, server] = Object.values(new WebSocketPair());
    server.accept();

    this.connections.add(server);
    server.lastActive = Date.now();
    server.isDevice = false;

    if (!await this.state.storage.getAlarm()) {
      await this.state.storage.setAlarm(Date.now() + 10000);
    }

    server.addEventListener("message", async (msg) => {
      const dataString = msg.data;
      server.lastActive = Date.now();

      if (typeof dataString === "string" && dataString.startsWith("id:")) {
        return; 
      }

      try {
        const json = JSON.parse(dataString);

        if (json.type === "register" && json.deviceId) {
          const existing = this.sessions.get(json.deviceId);
          if (existing && existing !== server) {
            existing.close(1000, "New session started");
            this.connections.delete(existing);
          }
          server.deviceId = json.deviceId;
          server.isDevice = true;
          this.sessions.set(json.deviceId, server);
          this.broadcastDeviceList();
          return;
        }

        if (json.type === "getList") {
          server.send(JSON.stringify({ 
            type: "deviceList", 
            devices: Array.from(this.sessions.keys()) 
          }));
          return;
        }

        if (json.targetId && json.command) {
          const target = this.sessions.get(json.targetId);
          if (target?.readyState === 1) target.send(json.command);
          return;
        }
      } catch (e) {
        for (const c of this.connections) {
          if (c !== server && !c.isDevice && c.readyState === 1) c.send(dataString);
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
}

// --- ЭКСПОРТ ДЛЯ WORKER ---
const ws_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const id = env.WS_ROOM.idFromName(url.searchParams.get("room") || "default");
    return env.WS_ROOM.get(id).fetch(request);
  }
};

export { ws_default as default, wsRoom };
