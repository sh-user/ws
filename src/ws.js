var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

var wsRoom = class {
  static { __name(this, "wsRoom"); }
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.connections = new Set(); // Все активные соединения
    this.sessions = new Map();    // Только зарегистрированные платы [deviceId -> socket]
  }

  // Рассылка списка устройств всем веб-клиентам (браузерам)
  broadcastDeviceList(deviceArray) {
    const listMessage = JSON.stringify({
      type: "deviceList",
      devices: deviceArray || Array.from(this.sessions.keys())
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
    
    server.isDevice = false; // По умолчанию считаем браузером
    server.deviceId = null;
    server.lastActive = Date.now();

    server.addEventListener("message", async (event) => {
      const message = event.data;

      // 1. ПРОВЕРКА ОТВЕТА ОТ ПЛАТЫ (на ваш запрос "?")
      if (typeof message === "string" && message.startsWith("id:")) {
        const receivedId = message.replace("id:", "");
        if (server.deviceId === receivedId) {
          server.lastActive = Date.now();
        }
        return;
      }

      try {
        const data = JSON.parse(message);

        // 2. РЕГИСТРАЦИЯ ПЛАТЫ (вызывается вашей sendRegistration())
        if (data.type === "register" && data.deviceId) {
          server.deviceId = data.deviceId;
          server.isDevice = true;
          server.lastActive = Date.now();
          this.sessions.set(data.deviceId, server);
          
          // Мгновенно обновляем список у всех при появлении новой платы
          this.broadcastDeviceList();
          return;
        }

        // 3. ЗАПРОС СПИСКА ОТ БРАУЗЕРА (С ПЕРЕКЛИЧКОЙ)
        if (data.type === "getList") {
          // Рассылаем всем платам "?"
          for (const [id, socket] of this.sessions.entries()) {
            try { socket.send("?"); } catch(e) {}
          }

          // Ждем 300мс ответов "id:..." от плат
          await new Promise(r => setTimeout(r, 1000));

          const activeDevices = [];
          for (const [id, socket] of this.sessions.entries()) {
            // Если плата ответила недавно и сокет открыт
            const isAlive = socket.readyState === 1 && (Date.now() - (socket.lastActive || 0) < 500);
            if (isAlive) {
              activeDevices.push(id);
            } else {
              this.sessions.delete(id);
              this.connections.delete(socket);
            }
          }

          // Отправляем запросившему свежий список
          server.send(JSON.stringify({ type: "deviceList", devices: activeDevices }));
          
          // Опционально: синхронизируем список у всех остальных
          this.broadcastDeviceList(activeDevices);
          return;
        }

        // 4. АДРЕСНАЯ КОМАНДА (Браузер -> Плата)
        if (data.targetId && data.command) {
          const targetSocket = this.sessions.get(data.targetId);
          if (targetSocket && targetSocket.readyState === 1) {
            targetSocket.send(data.command);
          }
          return;
        }

      } catch (e) {
        // 5. ОБЫЧНЫЙ BROADCAST (Чат / Логи)
        // Пересылаем всем, кроме отправителя и плат
        for (const conn of this.connections) {
          if (conn !== server && !conn.isDevice && conn.readyState === 1) {
            conn.send(message);
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
    // Убедитесь, что в wrangler.toml прописано именно WS_ROOM (или исправьте тут)
    const id = env.WS_ROOM.idFromName(roomId);
    const stub = env.WS_ROOM.get(id);
    return stub.fetch(request);
  }
};

export { ws_default as default, wsRoom };
