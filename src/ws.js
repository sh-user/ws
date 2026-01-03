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

      // Если плата молчит > 40 сек — удаляем из списка активных
      if (now - (socket.lastActive || 0) > 40000) {
        socket.close(1011, "Heartbeat timeout");
        this.sessions.delete(id);
        this.connections.delete(socket);
        hasChanges = true;
      } else {
        // Отправляем пинг. Плата должна ответить JSON-ом с типом "register"
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
      // ИСПРАВЛЕНИЕ: Декодируем данные, так как W5500 может слать бинарный поток
      const dataString = typeof msg.data === "string" ? msg.data : new TextDecoder().decode(msg.data);
      
      // Если это просто эхо старого протокола "id:", игнорируем
      if (dataString.startsWith("id:")) return;

      try {
        const json = JSON.parse(dataString);

        // РЕГИСТРАЦИЯ ПЛАТЫ
        // Важно: в прошивке должно быть: {"type":"register", "deviceId":"..."}
        if (json.type === "register" && json.deviceId) {
          server.lastActive = Date.now();
          server.isDevice = true;
          server.deviceId = json.deviceId;
          // Проверяем, есть ли уже такая плата в списке сессий
          const existing = this.sessions.get(json.deviceId);
          // ЛОГИКА: Рассылаем список ТОЛЬКО если это новое соединение
          if (existing !== server) {
            // Если под этим ID был другой сокет — удаляем его
            if (existing) {
              try { existing.close(1000, "New session started"); } catch(e) {}
              this.connections.delete(existing);
            }
            // Сохраняем новую активную сессию
            this.sessions.set(json.deviceId, server);
            // Сообщаем браузерам, что состав устройств изменился
            this.broadcastDeviceList();
            console.log(`Device registered: ${json.deviceId}`);
          } 
          // Если existing === server, значит это просто ответ на "?" (heartbeat).
          // Мы уже обновили lastActive выше, поэтому просто выходим без рассылки списка.
          return;
        }

        // ЗАПРОС СПИСКА (от браузера)
        if (json.type === "getList") {
          server.send(JSON.stringify({ 
            type: "deviceList", 
            devices: Array.from(this.sessions.keys()) 
          }));
          return;
        }

        // ПЕРЕСЫЛКА КОМАНДЫ (от браузера к конкретной плате)
        if (json.targetId && json.command) {
          const target = this.sessions.get(json.targetId);
          if (target?.readyState === 1) target.send(json.command);
          return;
        }
      } catch (e) {
        // Если это НЕ JSON — значит это поток данных сканирования от tinySA
        if (server.isDevice) {
          server.lastActive = Date.now(); // Любые данные от платы считаем за активность
        }

        // Рассылаем сырые данные всем браузерам
        for (const c of this.connections) {
          if (c !== server && !c.isDevice && c.readyState === 1) {
            try { c.send(dataString); } catch(err) {}
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
