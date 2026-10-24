
(() => {
  "use strict";

  const digits = [];
  const MAX_TICKS = 100;
  let tickCount = 0;

  const get = (id) => document.getElementById(id);

  function setText(id, value) {
    const element = get(id);
    if (element) element.textContent = value;
  }

  function reset() {
    digits.length = 0;
    tickCount = 0;

    setText("tickCount", "0");
    setText("lastDigit", "—");
    setText("marketStatus", "WAIT");
    setText("dataStatus", "PENDING");
    setText("analysisStatus", "WAIT");
    setText("price", "Waiting for data...");
  }

  function onTick(quote) {
    if (!Number.isFinite(quote) || quote < 0) return;

    const price = String(quote);
    const decimalPart = price.includes(".")
      ? price.split(".")[1]
      : "";
    const lastDigit = Number(
      (decimalPart + "0").slice(-1)
    );

    digits.push(lastDigit);

    if (digits.length > MAX_TICKS) {
      digits.shift();
    }

    tickCount++;

    setText("price", price);
    setText("lastDigit", String(lastDigit));
    setText("tickCount", String(tickCount));
    setText("dataStatus", "RECEIVING");

    if (digits.length < MAX_TICKS) {
      setText("marketStatus", "WAIT");
      setText("analysisStatus",
        `${digits.length}/${MAX_TICKS} TICKS`);
      return;
    }

    const counts = Array(10).fill(0);

    for (const digit of digits) {
      counts[digit]++;
    }

    const maxCount = Math.max(...counts);
    const mostFrequent = counts.indexOf(maxCount);
    const frequency = (maxCount / digits.length) * 100;

    setText("marketStatus", "WAIT");
    setText(
      "analysisStatus",
      `Digit ${mostFrequent}: ${frequency.toFixed(1)}%`
    );
    setText("dataStatus", "100 TICKS READY");
  }

  window.OrbisAnalysis = {
    reset,
    onTick
  };

  reset();
})();
              
