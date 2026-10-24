
(() => {
  "use strict";

  // Use your registered numeric Deriv App ID.
  // Never put an API token or secret here.
  const APP_ID = "1089";
  const ENDPOINT =
    "wss://ws.derivws.com/websockets/v3?app_id=";

  const $ = (id) => document.getElementById(id);
  let socket = null;
  let retryTimer = null;
  let retries = 0;
  let stopped = true;
  let requestId = 0;

  function status(text) {
    const el = $("connection");
    if (el) el.textContent = "● " + text;
  }

  function message(text) {
    const el = $("message");
    if (el) el.textContent = text;
  }

  function resetAnalysis() {
    if (window.OrbisAnalysis?.reset) {
      window.OrbisAnalysis.reset();
    }
  }

  function disconnect(manual = true) {
    if (manual) stopped = true;
    clearTimeout(retryTimer);
    retryTimer = null;

    const old = socket;
    socket = null;
    if (old && old.readyState < WebSocket.CLOSING) {
      old.close();
    }
  }

  function scheduleRetry() {
    if (stopped) return;

    if (retries >= 5) {
      message("Reconnect limit reached. Check your internet and App ID.");
      return;
    }

    retries++;
    const delay = Math.min(2000 * retries, 10000);
    message("Reconnecting in " + (delay / 1000) + " seconds...");
    retryTimer = setTimeout(connect, delay);
  }

  function connect() {
    clearTimeout(retryTimer);

    if (socket &&
        (socket.readyState === WebSocket.OPEN ||
         socket.readyState === WebSocket.CONNECTING)) {
      message("Connection is already active.");
      return;
    }

    if (!/^\d+$/.test(APP_ID)) {
      status("APP ID ERROR");
      message("App ID must contain digits only. Do not use an API token.");
      return;
    }

    stopped = false;
    const market = $("market")?.value || "R_10";

    status("CONNECTING");
    message("Connecting to Deriv for " + market + "...");

    let ws;
    try {
      ws = new WebSocket(
        ENDPOINT + encodeURIComponent(APP_ID)
      );
      socket = ws;
    } catch (error) {
      status("CONNECTION ERROR");
      message("Could not open WebSocket. Check your internet.");
      scheduleRetry();
      return;
    }

    ws.onopen = () => {
      if (socket !== ws) return;

      retries = 0;
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
        message("Could not read the server response.");
        return;
      }

      if (data.error) {
        status("API ERROR");
        message("Deriv error: " +
          (data.error.message || "Unknown error"));
        return;
      }

      if (data.msg_type === "tick" && data.tick) {
        const quote = Number(data.tick.quote);

        if (Number.isFinite(quote)) {
          if (window.OrbisAnalysis?.onTick) {
            window.OrbisAnalysis.onTick(quote);
          } else if ($("price")) {
            $("price").textContent = String(data.tick.quote);
          }

          status("LIVE");
          message("Live tick received for " + market + ".");
        }
      }
    };

    ws.onerror = () => {
      if (socket === ws) {
        message("WebSocket error. Check your connection and App ID.");
      }
    };

    ws.onclose = (event) => {
      if (socket !== ws) return;

      socket = null;
      status("DISCONNECTED");

      message("Socket closed (code " + event.code + ")." +
        (event.code === 1006
          ? " Abnormal closure. Check internet and registered App ID."
          : ""));

      scheduleRetry();
    };
  }

  $("connectBtn")?.addEventListener("click", () => {
    if (socket &&
        (socket.readyState === WebSocket.OPEN ||
         socket.readyState === WebSocket.CONNECTING)) {
      disconnect(true);
      status("DISCONNECTED");
      message("Connection stopped.");
      $("connectBtn").textContent = "Connect to Deriv";
    } else {
      resetAnalysis();
      retries = 0;
      connect();
      $("connectBtn").textContent = "Disconnect";
    }
  });

  $("market")?.addEventListener("change", () => {
    const reconnect = !stopped;
    disconnect(false);
    resetAnalysis();

    if (reconnect) {
      stopped = false;
      retries = 0;
      connect();
    }
  });

  window.addEventListener("beforeunload", () => disconnect(true));
  status("DISCONNECTED");
})();
  
