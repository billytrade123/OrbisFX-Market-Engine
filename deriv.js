
(() => {
  "use strict";

  // Replace 1089 with your registered Deriv App ID if needed.
  // This is an App ID, NOT an API token.
  const APP_ID = "1089";
  const ENDPOINT =
    "wss://ws.derivws.com/websockets/v3?app_id=";

  const get = (id) => document.getElementById(id);

  let socket = null;
  let manuallyClosed = false;
  let reconnectTimer = null;
  let attempts = 0;
  let requestId = 0;

  function status(text) {
    const el = get("connection");
    if (el) el.textContent = "● " + text;
  }

  function message(text) {
    const el = get("message");
    if (el) el.textContent = text;
  }

  function closeSocket() {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;

    const oldSocket = socket;
    socket = null;

    if (oldSocket &&
        oldSocket.readyState < WebSocket.CLOSING) {
      oldSocket.close();
    }
  }

  function connect() {
    manuallyClosed = false;
    clearTimeout(reconnectTimer);

    if (socket &&
        (socket.readyState === WebSocket.OPEN ||
         socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const market = get("market")?.value || "R_10";
    status("CONNECTING");
    message("Opening Deriv connection...");

    let ws;

    try {
      ws = new WebSocket(ENDPOINT + encodeURIComponent(APP_ID));
      socket = ws;
    } catch (error) {
      status("CONNECTION ERROR");
      message("Could not open the connection.");
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      if (socket !== ws) return;

      attempts = 0;
      status("CONNECTED");
      message("Connected. Requesting live ticks...");

      ws.send(JSON.stringify({
        ticks: market,
        subscribe: 1,
        req_id: ++requestId
      }));
    };

    ws.onmessage = (event) => {
      if (socket !== ws) return;

      let data;

      try {
        data = JSON.parse(event.data);
      } catch {
        message("Received an unreadable server response.");
        return;
      }

      if (data.error) {
        status("API ERROR");
        message(data.error.message || "Deriv returned an error.");
        return;
      }

      if (data.msg_type === "tick" && data.tick) {
        const tick = data.tick;

        if (window.OrbisAnalysis) {
          window.OrbisAnalysis.onTick(Number(tick.quote));
        }

        status("LIVE");
        message("Live ticks received.");
      }
    };

    ws.onerror = () => {
      if (socket === ws) {
        message("Connection error. Check App ID and internet.");
      }
    };

    ws.onclose = (event) => {
      if (socket !== ws) return;

      socket = null;
      status("DISCONNECTED");

      message(
        `Connection closed (code ${event.code}).`
      );

      if (!manuallyClosed) scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);

    if (manuallyClosed || attempts >= 5) {
      message(
        "Reconnect limit reached. Tap Connect to try again."
      );
      return;
    }

    attempts++;

    reconnectTimer = setTimeout(() => {
      if (!manuallyClosed) connect();
    }, Math.min(2000 * attempts, 10000));
  }

  function disconnect() {
    manuallyClosed = true;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    closeSocket();

    status("DISCONNECTED");
    message("Connection stopped.");
  }

  get("connectBtn")?.addEventListener("click", () => {
    if (socket &&
        (socket.readyState === WebSocket.OPEN ||
         socket.readyState === WebSocket.CONNECTING)) {
      disconnect();
      get("connectBtn").textContent = "Connect to Deriv";
    } else {
      attempts = 0;
      if (window.OrbisAnalysis) {
        window.OrbisAnalysis.reset();
      }
      connect();
      get("connectBtn").textContent = "Disconnect";
    }
  });

  get("market")?.addEventListener("change", () => {
    const wasConnected = !manuallyClosed;

    closeSocket();

    if (window.OrbisAnalysis) {
      window.OrbisAnalysis.reset();
    }

    if (wasConnected) {
      attempts = 0;
      connect();
    }
  });

  window.addEventListener("beforeunload", disconnect);

  status("DISCONNECTED");
})();
      
