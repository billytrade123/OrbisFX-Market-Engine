
(() => {
  "use strict";

  // ORBISFX MARKET ENGINE
  // DERIV LIVE MARKET CONNECTION

  const APP_ID = 1089;
  const WS_URL =
    `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

  const $ = id => document.getElementById(id);

  const state = {
    connected: false,
    connecting: false,
    symbol: "R_10",
    ticks: [],
    tickCount: 0,
    lastPrice: null,
    lastDigit: null,
    lastTickTime: null
  };

  let socket = null;
  let reconnectTimer = null;
  let connectionTimer = null;
  let pingTimer = null;
  let reconnectDelay = 3000;
  let manualDisconnect = false;

  function display(id, value) {
    const el = $(id);
    if (el) el.textContent = String(value);
  }

  function status(message, connected = false) {
    state.connected = connected;

    display(
      "connection",
      connected ? "● CONNECTED" : `● ${message.toUpperCase()}`
    );

    console.log("[OrbisFX]", message);
  }

  function reset() {
    state.ticks = [];
    state.tickCount = 0;
    state.lastPrice = null;
    state.lastDigit = null;
    state.lastTickTime = null;

    display("price", "Waiting for data...");
    display("lastDigit", "—");
    display("tickCount", "0");
    display("marketStatus", "WAIT");
    display("dataStatus", "PENDING");
    display("analysisStatus", "Waiting for live ticks");

    if (window.OrbisAnalysis?.reset) {
      window.OrbisAnalysis.reset();
    }
  }

  function selectedMarket() {
    return $("market")?.value || "R_10";
  }

  function clearTimers() {
    clearTimeout(reconnectTimer);
    clearTimeout(connectionTimer);
    clearInterval(pingTimer);

    reconnectTimer = null;
    connectionTimer = null;
    pingTimer = null;
  }

  function closeSocket() {
    const old = socket;
    socket = null;

    state.connected = false;
    state.connecting = false;

    if (old) {
      old.onopen = null;
      old.onmessage = null;
      old.onerror = null;
      old.onclose = null;

      try {
        old.close();
      } catch (error) {
        console.warn(error);
      }
    }
  }

  function scheduleReconnect() {
    if (manualDisconnect || reconnectTimer) return;

    status(`Reconnecting in ${Math.round(reconnectDelay / 1000)} seconds`);

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);

    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  }

  function getLastDigit(quote, precision) {
    const formatted = Number(quote).toFixed(precision);
    return Number(formatted.replace(".", "").slice(-1));
  }

  function connect() {
    manualDisconnect = false;

    clearTimers();
    closeSocket();
    reset();

    state.symbol = selectedMarket();
    state.connecting = true;

    if (!navigator.onLine) {
      state.connecting = false;
      status("Internet unavailable");
      display("message", "Check your internet connection.");
      scheduleReconnect();
      return;
    }

    status("Connecting to Deriv");

    try {
      socket = new WebSocket(WS_URL);
    } catch (error) {
      state.connecting = false;
      status("WebSocket initialization failed");
      display("message", error.message);
      scheduleReconnect();
      return;
    }

    const ws = socket;

    connectionTimer = setTimeout(() => {
      if (socket === ws && ws.readyState !== WebSocket.OPEN) {
        display("message", "Connection timeout. Retrying...");
        ws.close();
      }
    }, 15000);

    ws.onopen = () => {
      if (socket !== ws) return;

      clearTimeout(connectionTimer);
      state.connecting = false;
      reconnectDelay = 3000;

      status("Connected — requesting market ticks", true);
      display("message", "Connected. Waiting for live ticks...");

      ws.send(JSON.stringify({
        ticks: state.symbol,
        subscribe: 1
      }));

      // Keep connection alive.
      pingTimer = setInterval(() => {
        if (socket === ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ ping: 1 }));
        }
      }, 12000);
    };

    ws.onmessage = event => {
      if (socket !== ws) return;

      let data;

      try {
        data = JSON.parse(event.data);
      } catch (error) {
        console.warn("[OrbisFX] Invalid server response");
        return;
      }

      if (data.error) {
        const message =
          data.error.message || "Unknown Deriv API error";

        console.error("[OrbisFX] API error:", data.error);

        display("message", message);
        status(`API error: ${message}`);

        if (/app.?id|application/i.test(message)) {
          manualDisconnect = true;
          clearTimers();
          closeSocket();
        }

        return;
      }

      if (data.msg_type === "ping") return;

      if (data.msg_type !== "tick" || !data.tick) return;

      const tick = data.tick;
      const quote = Number(tick.quote);
      const precision = Math.max(
        0,
        Number(tick.pip_size) || 0
      );

      if (!Number.isFinite(quote)) return;

      const price = quote.toFixed(precision);
      const digit = getLastDigit(quote, precision);

      state.tickCount++;
      state.lastPrice = quote;
      state.lastDigit = digit;
      state.lastTickTime = tick.epoch;

      state.ticks.push({
        price: quote,
        digit,
        epoch: tick.epoch
      });

      if (state.ticks.length > 100) {
        state.ticks.shift();
      }

      display("price", price);
      display("lastDigit", digit);
      display("tickCount", state.tickCount);
      display("dataStatus", "RECEIVING");
      display("marketStatus", "WAIT");
      display("message", `LIVE DATA: ${state.symbol}`);

      if (window.OrbisAnalysis?.onTick) {
        window.OrbisAnalysis.onTick(quote);
      }

      status("Live market data receiving", true);
    };

    ws.onerror = error => {
      if (socket !== ws) return;

      console.error("[OrbisFX] WebSocket error:", error);

      display("message", "WebSocket error. Check network and App ID.");
      status("WebSocket error");
    };

    ws.onclose = event => {
      if (socket !== ws) return;

      socket = null;
      state.connected = false;
      state.connecting = false;

      clearTimers();

      console.warn(
        "[OrbisFX] Closed:",
        event.code,
        event.reason
      );

      status(`Disconnected — code ${event.code}`);

      display(
        "message",
        `Connection closed: ${event.code}. ${
          event.reason || "No reason supplied"
        }`
      );

      scheduleReconnect();
    };
  }

  function disconnect() {
    manualDisconnect = true;

    clearTimers();
    closeSocket();

    status("Disconnected");
    display("message", "Disconnected manually.");
  }

  function changeMarket() {
    if (!manualDisconnect) connect();
  }

  function init() {
    const button = $("connectBtn");
    const market = $("market");

    if (button) {
      button.addEventListener("click", () => {
        if (state.connected || state.connecting) {
          disconnect();
        } else {
          connect();
        }
      });
    }

    if (market) {
      market.addEventListener("change", changeMarket);
    }

    window.addEventListener("online", () => {
      if (!manualDisconnect) connect();
    });

    window.addEventListener("offline", () => {
      status("Internet disconnected");
      display("message", "Waiting for internet connection...");
    });

    reset();
    status("Ready to connect");

    console.log("[OrbisFX] Market engine initialized");

    connect();
  }

  window.OrbisDeriv = {
    connect,
    disconnect,

    getState() {
      return {
        ...state,
        ticks: state.ticks.slice()
      };
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();
        
