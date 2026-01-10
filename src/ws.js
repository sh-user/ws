var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// --- КЛАСС DURABLE OBJECT (Cloudflare Workers) ---
class wsRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.connections = new Set(); // Все активные сокеты
    this.sessions = new Map();    // Только зарегистрированные устройства (ID -> Socket)
    this.browsers = new Set();    // Только подключенные браузеры
  }

  // Периодическая проверка «живучести» (раз в 20 секунд)
  async alarm() {
    const now = Date.now();
    let hasChanges = false;

    for (const [id, socket] of this.sessions.entries()) {
      // 1. Проверка физического соединения
      if (socket.readyState !== 1) {
        this.sessions.delete(id);
        this.connections.delete(socket);
        hasChanges = true;
        continue;
      }

      // 2. Проверка логического таймаута (40 секунд тишины)
      if (now - (socket.lastActive || 0) > 40000) {
        console.log(`Кикаю устройство ${id} по таймауту`);
        socket.close(1011, "Heartbeat timeout");
        this.sessions.delete(id);
        this.connections.delete(socket);
        hasChanges = true;
      } else {
        // 3. Запрос подтверждения (Плата должна ответить регистрацией)
        try { socket.send("?"); } catch (e) {}
      }
    }

    // Если список устройств изменился — уведомляем браузеры
    if (hasChanges) this.broadcastDeviceList();
    
    // Планируем следующую проверку
    await this.state.storage.setAlarm(Date.now() + 20000);
  }

  // Рассылка списка активных плат всем браузерам
  broadcastDeviceList() {
    const devices = Array.from(this.sessions.keys());
    const msg = JSON.stringify({ type: "devices", list: devices });
    for (const browser of this.browsers) {
      if (browser.readyState === 1) {
        try { browser.send(msg); } catch (e) {}
      }
    }
  }

  async fetch(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    server.accept();
    server.lastActive = Date.now();
    server.isDevice = false; // По умолчанию считаем браузером
    
    this.connections.add(server);
    this.browsers.add(server); // Добавляем в список браузеров

    // Запускаем таймер проверок, если он еще не запущен
    let alarm = await this.state.storage.getAlarm();
    if (!alarm) await this.state.storage.setAlarm(Date.now() + 20000);

    server.addEventListener("message", async (msg) => {
      // КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ: Обновляем активность при ЛЮБОМ сообщении
      server.lastActive = Date.now();

      const data = msg.data;
      const isString = typeof data === "string";
      const dataString = isString ? data : new TextDecoder().decode(data);

      // Игнорируем технические префиксы
      if (dataString.startsWith("id:")) return;

      // ОПТИМИЗАЦИЯ: Если это не JSON (не начинается с {), обрабатываем как данные сканера
      if (dataString[0] !== '{') {
        this.handleRawData(server, data);
        return;
      }

      try {
        const json = JSON.parse(dataString);

        // 1. РЕГИСТРАЦИЯ ПЛАТЫ
        if (json.type === "register" && json.deviceId) {
          server.isDevice = true;
          server.deviceId = json.deviceId;
          this.browsers.delete(server); // Это не браузер, убираем из рассылки

          const existing = this.sessions.get(json.deviceId);
          if (existing !== server) {
            if (existing) {
              try { existing.close(1000, "New session started"); } catch(e) {}
              this.connections.delete(existing);
            }
            this.sessions.set(json.deviceId, server);
            this.broadcastDeviceList();
          }
          return;
        }

        // 2. ВЫБОР ПЛАТЫ БРАУЗЕРОМ
        if (json.type === "selectDevice") {
          server.selectedDeviceId = json.deviceId;
          return;
        }

        // 3. КОМАНДЫ ОТ БРАУЗЕРА К ПЛАТЕ
        if (json.targetId && json.command) {
          const target = this.sessions.get(json.targetId);
          if (target?.readyState === 1) target.send(json.command);
          return;
        }
      } catch (e) {
        // Если JSON не распарсился, но сокет помечен как устройство — шлем как сырые данные
        this.handleRawData(server, data);
      }
    });

    server.addEventListener("close", () => {
      this.connections.delete(server);
      this.browsers.delete(server);
      if (server.deviceId) {
        this.sessions.delete(server.deviceId);
        this.broadcastDeviceList();
      }
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  // Вспомогательная функция для быстрой рассылки данных сканера
  handleRawData(server, data) {
    if (server.isDevice) {
      // Рассылаем данные только тем браузерам, которые выбрали это устройство
      for (const browser of this.browsers) {
        if (browser.readyState === 1 && browser.selectedDeviceId === server.deviceId) {
          try { browser.send(data); } catch (err) {}
        }
      }
    } else {
      // Если это неизвестный сокет шлет данные — просим представиться
      try { server.send("?"); } catch (err) {}
    }
  }
}

const ws_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const id = env.WS_ROOM.idFromName(url.searchParams.get("room") || "default");
    return env.WS_ROOM.get(id).fetch(request);
  }
};

export { ws_default as default, wsRoom };
