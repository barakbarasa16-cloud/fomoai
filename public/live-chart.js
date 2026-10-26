/* FOMOAI live chart bridge.
   REST price polling is always active so the chart stays live even when the
   optional Birdeye WebSocket key is not configured. WebSocket ticks can
   improve latency when available. */
(function () {
  const POLL_MS = 3000;
  let timer = null;
  let metadataTimer = null;
  let generation = 0;
  let ws = null;
  let lastLivePrice = 0;

  const liveJson = async (url) => {
    const sep = url.includes("?") ? "&" : "?";
    const response = await fetch(url + sep + "_live=" + Date.now(), {
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
        Pragma: "no-cache"
      },
      cache: "no-store"
    });
    if (!response.ok) throw new Error("Live market returned " + response.status);
    return response.json();
  };

  const stopTimers = () => {
    generation += 1;
    if (timer) clearInterval(timer);
    if (metadataTimer) clearInterval(metadataTimer);
    timer = null;
    metadataTimer = null;
  };

  const closeWs = () => {
    if (ws) {
      try {
        ws.onclose = null;
        ws.close();
      } catch {}
    }
    ws = null;
  };

  const stop = () => {
    stopTimers();
    closeWs();
    window.__fomoLiveLastCandle = null;
    lastLivePrice = 0;
  };

  const setMeta = (x, p, source) => {
    const el = document.querySelector("#chartMeta");
    if (!el) return;
    const change = Number(x.change24h || 0);
    el.textContent = "LIVE ⚡ • " + x.chain + " · " + price(p) +
      " · " + (change >= 0 ? "+" : "") + change.toFixed(2) +
      "% 24h · " + source + " · " + new Date().toLocaleTimeString();
  };

  const setFacts = (x, p) => {
    const facts = document.querySelector("#chartFacts");
    if (!facts || typeof setupFor !== "function") return;
    const setup = setupFor({ ...x, priceUsd: p });
    facts.innerHTML = [
      ["LIVE price", price(p)],
      ["24h volume", money(x.volume24h)],
      ["Liquidity", money(x.liquidityUsd)],
      ["Buy pressure", x.buyPressure + "%"],
      ["Entry zone", price(setup.entryLow) + " – " + price(setup.entryHigh)],
      ["Stop loss", price(setup.stop)],
      ["Take profit 1", price(setup.tp1)],
      ["Take profit 2 / 3", price(setup.tp2) + " / " + price(setup.tp3)]
    ].map(([k, v]) => '<div class="fact"><small>' + k + '</small><b>' + v + '</b></div>').join("");
  };

  const updateRow = (x, p) => {
    try {
      const key = CSS.escape(x.chain + ":" + x.address);
      const row = document.querySelector('.coin-row[data-key="' + key + '"]');
      if (!row) return;
      const priceEl = row.querySelector(".coin-price");
      const changeEl = row.querySelector(".coin-change");
      if (priceEl) priceEl.textContent = price(p);
      if (changeEl) {
        const change = Number(x.change24h || 0);
        changeEl.textContent = (change >= 0 ? "▲ +" : "▼ ") + change.toFixed(2) + "%";
        changeEl.classList.toggle("green", change >= 0);
        changeEl.classList.toggle("red", change < 0);
      }
    } catch {}
  };

  const candleFromTick = (p, unixTime) => {
    if (!window.candleSeries || !Number.isFinite(p) || p <= 0) return;
    const now = Number(unixTime) || Math.floor(Date.now() / 1000);
    const unit = window.activeTf === "hour" ? 3600 : 60;
    const aggregate = Number(window.activeAgg) || 1;
    const bucket = aggregate * unit;
    const time = Math.floor(now / bucket) * bucket;
    let last = window.__fomoLiveLastCandle;

    if (!last || last.time !== time) {
      last = { time, open: p, high: p, low: p, close: p };
    } else {
      last = {
        time,
        open: Number(last.open) || p,
        high: Math.max(Number(last.high) || p, p),
        low: Math.min(Number(last.low) || p, p),
        close: p
      };
    }

    window.__fomoLiveLastCandle = last;
    try {
      window.candleSeries.update(last);
      window.priceChart?.timeScale().scrollToRealTime();
    } catch (error) {
      console.warn("Live candle update failed", error);
    }
  };

  const applyPrecision = (p) => {
    if (!window.candleSeries || !Number.isFinite(p) || p <= 0) return;
    const digits = Math.max(2, Math.min(12, Math.ceil(-Math.log10(p)) + 3));
    const minMove = Math.pow(10, -digits);
    try {
      window.candleSeries.applyOptions({
        priceFormat: { type: "price", precision: digits, minMove }
      });
    } catch {}
  };

  async function getPair(x) {
    let json = await liveJson("https://api.dexscreener.com/latest/dex/pairs/" +
      encodeURIComponent(x.chain) + "/" + encodeURIComponent(x.pairAddress)).catch(() => null);
    let pair = json?.pairs?.[0];

    if (!pair && x.address) {
      json = await liveJson("https://api.dexscreener.com/latest/dex/tokens/" +
        encodeURIComponent(x.address)).catch(() => null);
      const pairs = Array.isArray(json?.pairs) ? json.pairs : [];
      pair = pairs
        .filter(p => String(p.chainId).toLowerCase() === String(x.chain).toLowerCase())
        .sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0))[0] || pairs[0];
    }
    return pair;
  }

  async function poll(x, myGeneration) {
    if (!x || myGeneration !== generation || !window.candleSeries) return;
    try {
      const pair = await getPair(x);
      const current = Number(pair?.priceUsd || 0);
      if (!current) throw new Error("No fresh price");

      const fresh = {
        ...x,
        priceUsd: current,
        change24h: Number(pair.priceChange?.h24 ?? x.change24h),
        volume24h: Number(pair.volume?.h24 ?? x.volume24h),
        liquidityUsd: Number(pair.liquidity?.usd ?? x.liquidityUsd),
        pairAddress: pair.pairAddress || x.pairAddress
      };

      candleFromTick(current, Math.floor(Date.now() / 1000));
      applyPrecision(current);
      setMeta(fresh, current, "DEX live");
      setFacts(fresh, current);
      updateRow(fresh, current);
      lastLivePrice = current;
    } catch (error) {
      console.warn("REST live price update failed", error);
    }
  }

  const startPolling = (x, myGeneration) => {
    if (timer) clearInterval(timer);
    timer = setInterval(() => poll(window.__fomoSelected || x, myGeneration), POLL_MS);
  };

  const openWs = (x, myGeneration) => {
    if (!x || x.chain !== "solana" || !window.WebSocket || !window.candleSeries) return;
    closeWs();
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    try {
      ws = new WebSocket(protocol + "://" + location.host + "/ws");
    } catch {
      return;
    }

    ws.onopen = () => {
      if (myGeneration !== generation) return;
      ws.send(JSON.stringify({ action: "subscribe", address: x.address }));
    };

    ws.onmessage = (event) => {
      if (myGeneration !== generation) return;
      try {
        const message = JSON.parse(event.data);
        if (message.type !== "PRICE_DATA") return;
        const data = message.data || {};
        const current = Number(data.c || data.price || data.value || 0);
        if (!current) return;
        candleFromTick(current, data.unixTime);
        applyPrecision(current);
        setMeta(x, current, "WebSocket live");
        setFacts(x, current);
        updateRow(x, current);
        lastLivePrice = current;
      } catch {}
    };
  };

  const originalLoadCandles = window.loadCandles;
  window.loadCandles = async function (x) {
    stop();
    window.__fomoSelected = x;
    window.__fomoLiveLastCandle = null;

    if (originalLoadCandles) await originalLoadCandles(x);
    if (!window.__fomoSelected || !window.candleSeries) return;

    const myGeneration = generation;
    await poll(x, myGeneration);
    startPolling(x, myGeneration);
    openWs(x, myGeneration);

    metadataTimer = setInterval(() => {
      if (myGeneration === generation && window.__fomoSelected) {
        poll(window.__fomoSelected, myGeneration);
      }
    }, 15000);
  };

  document.addEventListener("click", (event) => {
    if (event.target?.id === "closeChart") {
      setTimeout(() => {
        stop();
        window.__fomoSelected = null;
      }, 0);
    }

    if (event.target?.matches?.("[data-tf]")) {
      setTimeout(() => {
        if (window.__fomoSelected && window.candleSeries) {
          stop();
          window.__fomoLiveLastCandle = null;
          const myGeneration = generation;
          poll(window.__fomoSelected, myGeneration);
          startPolling(window.__fomoSelected, myGeneration);
          openWs(window.__fomoSelected, myGeneration);
          metadataTimer = setInterval(() => {
            if (myGeneration === generation && window.__fomoSelected) {
              poll(window.__fomoSelected, myGeneration);
            }
          }, 15000);
        }
      }, 300);
    }
  });

  window.addEventListener("beforeunload", stop);
})();
