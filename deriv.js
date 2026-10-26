
(() => {
  "use strict";

  // OrbisFX Market Engine — Deriv live tick connection
  const APP_ID = "1089";
  const ENDPOINT =
    `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

  const $ = (id) => document.getElementById(id);

  let socket = null;
  let reconnectTimer = null;
  let connectionTimeout = null;
  let manuallyDisconnected = false;
  let reconnectDelay = 2000;
  let tickCount = 0;

  const state = {
    symbol: "R_10",
    connected: false,
    ticks: []
  };

  function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = String(value);
  }

  function setStatus(message, connected = false) {
    state.connected = connected;

    const status = $("connection");
    if (status) {
      status.textContent = connected
        ? "● CONNECTED"
        : `● ${message.toUpperCase()}`;
    }

    console.log("[OrbisFX]", message);
  }

  function clearTimers() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (connectionTimeout) clearTimeout(connectionTimeout);

    reconnectTimer = null;
    connectionTimeout = null;
  }

  function resetDisplay() {
    tickCount = 0;
    state.ticks = [];

    setText("price", "Waiting for data...");
    setText("lastDigit", "—");
    setText("tickCount", "0");
    setText("marketStatus", "WAIT");
    setText("dataStatus", "PENDING");
    setText("analysisStatus", "Waiting for live ticks");

    if (window.OrbisAnalysis) {
      window.OrbisAnalysis.reset();
    }
  }

  function getSymbol() {
    const market = $("market");
    return market && market.value ? market.value : "R_10";
  }

  function getLastDigit(quote, pipSize) {
    const decimals = Math.max(0, Number(pipSize) || 0);
    const formatted = Number(quote).toFixed(decimals);
    const digits = formatted.replace(/\D/g, "");

    return Number(digits.charAt(digits.length - 1));
  }

  function closeSocket() {
    const oldSocket = socket;
    socket = null;
    state.connected = false;

    if (oldSocket) {
      oldSocket.onopen = null;
      oldSocket.onmessage = null;
      oldSocket.onerror = null;
      oldSocket.onclose = null;

      try {
        oldSocket.close();
      } catch (error) {
        console.warn("[OrbisFX] Close error:", error);
      }
    }
  }

  function scheduleReconnect() {
    if (manuallyDisconnected || reconnectTimer) return;

    setStatus(
      `Disconnected — retrying in ${Math.round(reconnectDelay / 1000)} seconds`
    );

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);

    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  }

  function connect() {
    manuallyDisconnected = false;
    clearTimers();
    closeSocket();
    resetDisplay();

    state.symbol = getSymbol();
    setStatus("Connecting to Deriv");

    if (!navigator.onLine) {
      setStatus("No internet connection");
      scheduleReconnect();
      return;
    }

    let ws;

    try {
      ws = new WebSocket(ENDPOINT);
      socket = ws;
    } catch (error) {
      console.error("[OrbisFX] WebSocket creation failed:", error);
      setStatus("Could not start WebSocket");
      scheduleReconnect();
      return;
    }

    connectionTimeout = setTimeout(() => {
      if (socket === ws && ws.readyState !== WebSocket.OPEN) {
        setStatus("Connection timed out");
        try {
          ws.close();
        } catch (_) {}
      }
    }, 15000);

    ws.onopen = () => {
      if (socket !== ws) return;

      clearTimers();
      reconnectDelay = 2000;
      setStatus("Connected — requesting live ticks", true);
      setText("message", "Connected. Waiting for the first tick...");

      ws.send(JSON.stringify({
        ticks: state.symbol,
        subscribe: 1
      }));
    };

    ws.onmessage = (event) => {
      if (socket !== ws) return;

      let data;

      try {
        data = JSON.parse(event.data);
      } catch (error) {
        console.warn("[OrbisFX] Invalid server response:", error);
        return;
      }

      if (data.error) {
        const message =
          data.error.message || "Unknown Deriv API error";

        console.error("[OrbisFX] API error:", data.error);
        setStatus(`API error: ${message}`);
        setText("message", message);
        return;
      }

      if (data.msg_type !== "tick" || !data.tick) return;

      const tick = data.tick;
      const quote = Number(tick.quote);

      if (!Number.isFinite(quote)) return;

      const priceText = typeof tick.quote === "string"
        ? tick.quote
        : quote.toFixed(Number(tick.pip_size) || 2);

      const digit = getLastDigit(quote, tick.pip_size);

      tickCount += 1;
      state.ticks.push({
        price: quote,
        digit,
        epoch: tick.epoch
      });

      if (state.ticks.length > 100) {
        state.ticks.shift();
      }

      setText("price", priceText);
      setText("lastDigit", digit);
      setText("tickCount", tickCount);
      setText("dataStatus", "RECEIVING");
      setText("message", `Receiving live ticks for ${state.symbol}`);

      if (window.OrbisAnalysis) {
        window.OrbisAnalysis.onTick(quote);
      }

      setStatus("Live ticks received", true);
    };

    ws.onerror = (event) => {
      if (socket !== ws) return;

      console.warn("[OrbisFX] WebSocket connection error:", event);
      setStatus("WebSocket error — checking connection");
      setText("message", "Connection error. Check App ID and network.");
    };

    ws.onclose = (event) => {
      if (socket !== ws) return;

      socket = null;
      state.connected = false;
      clearTimers();

      const reason = event.reason || "No reason supplied";
      console.warn(
        "[OrbisFX] Socket closed:",
        event.code,
        reason
      );

      setStatus(`Disconnected — code ${event.code}`);
      setText(
        "message",
        `Connection closed (code ${event.code}). ${reason}`
      );

      scheduleReconnect();
    };
  }

  function disconnect() {
    manuallyDisconnected = true;
    clearTimers();
    closeSocket();
    setStatus("Disconnected");
    setText("message", "Disconnected. Tap Connect to restart.");
  }

  function changeMarket() {
    state.symbol = getSymbol();

    if (state.connected || (socket && socket.readyState <= 1)) {
      connect();
    } else {
      resetDisplay();
      setText("message", "Market selected. Tap Connect to start.");
    }
  }

  function init() {
    const connectButton = $("connectBtn");
    const market = $("market");

    if (connectButton) {
      connectButton.addEventListener("click", () => {
        if (state.connected) {
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
      if (!manuallyDisconnected) connect();
    });

    window.addEventListener("offline", () => {
      setStatus("Internet disconnected");
    });

    resetDisplay();
    setStatus("Ready to connect");
  }

  window.OrbisDeriv = {
    connect,
    disconnect,
    getState: () => ({
      symbol: state.symbol,
      connected: state.connected,
      tickCount,
      recentTicks: state.ticks.slice()
    })
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
    
