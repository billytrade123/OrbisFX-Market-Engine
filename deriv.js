(() => {
  "use stri
  const ENDPOINT =
    `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;
const APP_ID = "34Mv5GktLBng7YrXnOgc7";
  let socket = null;
  let retryTimer = null;
  let heartbeatTimer = null;
  let manuallyClosed = false;
  let reconnectDelay = 2000;

  const state = {
    connected: false,
    symbol: "1HZ10V",
    lastPrice: null,
    lastDigit: null,
    ticks: [],
    tickCount: 0
  };

  function byId(...ids) {
    for (const id of ids) {
      const element = document.getElementById(id);
      if (element) return element;
    }
    return null;
  }

  function showStatus(message, connected = false) {
    state.connected = connected;

    const element = byId(
      "connectionStatus",
      "connection-status",
      "status",
      "connection"
    );

    if (element) element.textContent = message;

    const dot = byId("statusDot", "connectionDot");
    if (dot) dot.style.backgroundColor = connected ? "#22c55e" : "#f59e0b";

    console.log("[OrbisFX]", message);
  }

  function showPrice(price) {
    const element = byId(
      "livePrice",
      "price",
      "currentPrice",
      "latestPrice"
    );

    if (element) element.textContent = String(price);
  }

  function showDigit(digit) {
    const element = byId("lastDigit", "last-digit", "digit");
    if (element) element.textContent = String(digit);
  }

  function showTickCount(count) {
    const element = byId("tickCount", "ticksReceived");
    if (element) element.textContent = String(count);
  }

  function getSelectedSymbol() {
    const selector = byId("marketSelect", "market", "symbol", "marketSelector");
    return selector && selector.value ? selector.value : state.symbol;
  }

  function extractLastDigit(quote, pipSize) {
    const decimals = Math.max(0, Number(pipSize) || 0);
    const fixed = Number(quote).toFixed(decimals);
    const digits = fixed.replace(/\D/g, "");
    return Number(digits.charAt(digits.length - 1));
  }

  function clearTimers() {
    if (retryTimer) clearTimeout(retryTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    retryTimer = null;
    heartbeatTimer = null;
  }

  function disconnect(manual = true) {
    manuallyClosed = manual;
    clearTimers();

    if (socket) {
      const oldSocket = socket;
      socket = null;

      try {
        oldSocket.onopen = null;
        oldSocket.onmessage = null;
        oldSocket.onerror = null;
        oldSocket.onclose = null;
        oldSocket.close();
      } catch (error) {
        console.warn("[OrbisFX] Disconnect issue:", error);
      }
    }

    state.connected = false;

    if (manual) showStatus("Disconnected");
  }

  function scheduleReconnect() {
    if (manuallyClosed || retryTimer) return;

    showStatus(`Disconnected — retrying in ${Math.round(reconnectDelay / 1000)}s`);

    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, reconnectDelay);

    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  }

  function connect() {
    manuallyClosed = false;
    clearTimers();

    if (socket) {
      try {
        socket.close();
      } catch (_) {}
    }

    state.symbol = getSelectedSymbol();
    showStatus("Connecting to Deriv…");

    try {
      socket = new WebSocket(ENDPOINT);
    } catch (error) {
      showStatus("Could not create WebSocket");
      console.error("[OrbisFX] WebSocket error:", error);
      scheduleReconnect();
      return;
    }

    const thisSocket = socket;

    const timeout = setTimeout(() => {
      if (thisSocket.readyState !== WebSocket.OPEN) {
        try {
          thisSocket.close();
        } catch (_) {}
      }
    }, 12000);

    thisSocket.onopen = () => {
      clearTimeout(timeout);

      if (socket !== thisSocket) return;

      reconnectDelay = 2000;
      showStatus("Connected — subscribing to live ticks", true);

      thisSocket.send(JSON.stringify({
        ticks: state.symbol,
        subscribe: 1
      }));

      heartbeatTimer = setInterval(() => {
        if (thisSocket.readyState === WebSocket.OPEN) {
          // Public tick subscriptions provide the live stream.
          // Do not send unsupported heartbeat messages.
        }
      }, 25000);
    };

    thisSocket.onmessage = event => {
      if (socket !== thisSocket) return;

      let data;

      try {
        data = JSON.parse(event.data);
      } catch (error) {
        console.warn("[OrbisFX] Invalid response:", error);
        return;
      }

      if (data.error) {
        console.error("[OrbisFX] Deriv API error:", data.error);
        showStatus(`API error: ${data.error.message || "Unknown error"}`);
        return;
      }

      if (data.msg_type === "tick" && data.tick) {
        const tick = data.tick;
        const price = Number(tick.quote);

        if (!Number.isFinite(price)) return;

        state.lastPrice = price;
        state.lastDigit = extractLastDigit(price, tick.pip_size);
        state.tickCount += 1;

        state.ticks.push(state.lastDigit);
        if (state.ticks.length > 100) state.ticks.shift();

        showPrice(tick.quote);
        showDigit(state.lastDigit);
        showTickCount(state.tickCount);

        document.dispatchEvent(new CustomEvent("orbisfx:tick", {
          detail: {
            symbol: tick.symbol,
            quote: tick.quote,
            digit: state.lastDigit,
            epoch: tick.epoch,
            ticks: [...state.ticks]
          }
        }));

        if (state.tickCount === 1) {
          showStatus("Live ticks received", true);
        }
      }
    };

    thisSocket.onerror = error => {
      console.error("[OrbisFX] WebSocket error:", error);
      showStatus("Connection error — check network and App ID");
    };

    thisSocket.onclose = event => {
      clearTimeout(timeout);

      if (socket !== thisSocket) return;

      clearTimers();
      socket = null;
      state.connected = false;

      showStatus(`Socket closed — code ${event.code}`);

      if (!manuallyClosed) scheduleReconnect();
    };
  }

  function bindControls() {
    const connectButton = byId("connectBtn", "connect", "connectButton");
    if (connectButton) {
      connectButton.addEventListener("click", () => connect());
    }

    const disconnectButton = byId("disconnectBtn", "disconnect");
    if (disconnectButton) {
      disconnectButton.addEventListener("click", () => disconnect(true));
    }

    const selector = byId("marketSelect", "market", "symbol", "marketSelector");
    if (selector) {
      selector.addEventListener("change", () => {
        if (state.connected) connect();
        else state.symbol = getSelectedSymbol();
      });
    }
  }

  window.OrbisFXDeriv = {
    connect,
    disconnect,
    getState: () => ({ ...state, ticks: [...state.ticks] })
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindControls);
  } else {
    bindControls();
  }

  console.log("[OrbisFX] Deriv module loaded.");
})();
