
(() => {
  "use strict";

  // ==========================================
  // ORBISFX MARKET ENGINE
  // DERIV LIVE TICK CONNECTION
  // ==========================================

  const APP_ID = "34Mv5GktLBng7YrXnOgc7";
  const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

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
  let reconnectDelay = 2000;
  let manualDisconnect = false;
  let subscriptionId = null;

  // ==========================================
  // DISPLAY HELPERS
  // ==========================================

  function display(id, value) {
    const element = $(id);
    if (element) element.textContent = String(value);
  }

  function status(message, connected = false) {
    state.connected = connected;
    state.connecting = false;

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

  function getDigit(quote, pipSize) {
    const precision = Math.max(0, Number(pipSize) || 0);
    const formatted = Number(quote).toFixed(precision);
    return Number(formatted.replace(".", "").slice(-1));
  }

  // ==========================================
  // CONNECTION MANAGEMENT
  // ==========================================

  function clearTimers() {
    clearTimeout(reconnectTimer);
    clearTimeout(connectionTimer);

    reconnectTimer = null;
    connectionTimer = null;
  }

  function closeConnection() {
    const oldSocket = socket;
    socket = null;

    state.connected = false;
    state.connecting = false;
    subscriptionId = null;

    if (oldSocket) {
      oldSocket.onopen = null;
      oldSocket.onmessage = null;
      oldSocket.onerror = null;
      oldSocket.onclose = null;

      try {
        oldSocket.close();
      } catch (error) {
        console.warn(error);
      }
    }
  }

  function reconnect() {
    if (manualDisconnect || reconnectTimer) return;

    status(`Reconnecting in ${reconnectDelay / 1000}s`);

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);

    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  }

  // ==========================================
  // CONNECT TO DERIV
  // ==========================================

  function connect() {
    manualDisconnect = false;

    clearTimers();
    closeConnection();
    reset();

    state.symbol = selectedMarket();

    if (!APP_ID || !/^\d+$/.test(APP_ID)) {
      status("Invalid App ID");
      display("message", "Check your registered numeric Deriv App ID.");
      return;
    }

    if (!navigator.onLine) {
      status("Internet unavailable");
      reconnect();
      return;
    }

    state.connecting = true;
    status("Connecting to Deriv");

    try {
      socket = new WebSocket(WS_URL);
    } catch (error) {
      status("WebSocket initialization failed");
      console.error(error);
      reconnect();
      return;
    }

    const ws = socket;

    connectionTimer = setTimeout(() => {
      if (socket === ws && ws.readyState !== WebSocket.OPEN) {
        display("message", "Connection timed out. Retrying...");
        ws.close();
      }
    }, 15000);

    ws.onopen = () => {
      if (socket !== ws) return;

      clearTimeout(connectionTimer);
      reconnectDelay = 2000;

      status("Connected — requesting live ticks", true);

      display("message", "Connected. Waiting for market data...");

      ws.send(JSON.stringify({
        ticks: state.symbol,
        subscribe: 1
      }));
    };

    // ========================================
    // RECEIVE LIVE MARKET DATA
    // ========================================

    ws.onmessage = event => {
      if (socket !== ws) return;

      let data;

      try {
        data = JSON.parse(event.data);
      } catch {
        console.warn("[OrbisFX] Invalid response");
        return;
      }

      if (data.error) {
        const errorMessage =
          data.error.message || "Unknown Deriv error";

        console.error("[OrbisFX] API error:", data.error);

        display("message", errorMessage);
        status(`API error: ${errorMessage}`);

        return;
      }

      if (data.msg_type !== "tick" || !data.tick) return;

      const tick = data.tick;
      const quote = Number(tick.quote);

      if (!Number.isFinite(quote)) return;

      const precision = Math.max(0, Number(tick.pip_size) || 0);
      const price = quote.toFixed(precision);
      const digit = getDigit(quote, precision);

      subscriptionId = tick.id || subscriptionId;

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

      // Update dashboard
      display("price", price);
      display("lastDigit", digit);
      display("tickCount", state.tickCount);
      display("dataStatus", "RECEIVING");
      display("message", `LIVE DATA: ${state.symbol}`);
      display("marketStatus", "WAIT");

      // Send data to analysis engine
      if (window.OrbisAnalysis?.onTick) {
        window.OrbisAnalysis.onTick(quote);
      }

      status("Live market data receiving", true);
    };

    // ========================================
    // ERROR HANDLING
    // ========================================

    ws.onerror = error => {
      if (socket !== ws) return;

      console.error("[OrbisFX] WebSocket error:", error);

      display("message", "Connection error. Check network and App ID.");
      status("WebSocket error");
    };

    ws.onclose = event => {
      if (socket !== ws) return;

      socket = null;
      subscriptionId = null;

      clearTimers();

      console.warn(
        "[OrbisFX] Connection closed:",
        event.code,
        event.reason
      );

      status(`Disconnected — code ${event.code}`);

      display(
        "message",
        `Connection closed: ${event.code}. ${event.reason || "No reason supplied"}`
      );

      reconnect();
    };
  }

  // ==========================================
  // DISCONNECT
  // ==========================================

  function disconnect() {
    manualDisconnect = true;

    clearTimers();
    closeConnection();

    status("Disconnected");

    display("message", "Disconnected. Press Connect to restart.");
  }

  // ==========================================
  // MARKET SELECTION
  // ==========================================

  function changeMarket() {
    state.symbol = selectedMarket();

    connect();
  }

  // ==========================================
  // DASHBOARD INITIALIZATION
  // ==========================================

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
    });

    reset();
    status("Ready to connect");

    console.log("[OrbisFX] Engine initialized");
  }

  // ==========================================
  // PUBLIC ORBISFX API
  // ==========================================

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
      
