/* FOMOAI live candlestick engine.
   The chart history comes from GeckoTerminal, while the active candle is
   refreshed directly from DexScreener every 2 seconds. This deliberately
   does not depend on wrapping app.js functions, so timeframe changes and
   token selection cannot silently disable the live updater. */
(function () {
  const POLL_MS = 2000;
  const DEX = "https://api.dexscreener.com";
  let timer = null;
  let activeKey = "";
  let liveCandle = null;
  let historySeedKey = "";
  let lastPrice = 0;

  const noCache = async (url) => {
    const sep = url.includes("?") ? "&" : "?";
    const r = await fetch(url + sep + "_live=" + Date.now(), {
      cache: "no-store",
      headers: { Accept: "application/json", "Cache-Control": "no-cache", Pragma: "no-cache" }
    });
    if (!r.ok) throw new Error("Market source returned " + r.status);
    return r.json();
  };

  const getSelectedKey = () => {
    const row = document.querySelector("#coinFeed .coin-row.selected");
    return row?.dataset?.key || "";
  };

  const getSelected = () => {
    const key = getSelectedKey();
    if (!key) return null;
    const i = key.indexOf(":");
    if (i < 1) return null;
    return { chain: key.slice(0, i), address: key.slice(i + 1), key };
  };

  const getTimeframe = () => {
    const b = document.querySelector("[data-tf].active") || document.querySelector("[data-tf]");
    const tf = b?.dataset?.tf === "hour" ? "hour" : "minute";
    const aggregate = Math.max(1, Number(b?.dataset?.agg || 1));
    const unit = tf === "hour" ? 3600 : 60;
    return { tf, aggregate, bucket: unit * aggregate };
  };

  const precisionFor = (p) => {
    if (!Number.isFinite(p) || p <= 0) return 2;
    return Math.max(2, Math.min(12, Math.ceil(-Math.log10(p)) + 3));
  };

  const applyPrecision = (p) => {
    if (typeof candleSeries === "undefined" || !candleSeries) return;
    const digits = precisionFor(p);
    try {
      candleSeries.applyOptions({
        priceFormat: { type: "price", precision: digits, minMove: Math.pow(10, -digits) }
      });
    } catch {}
  };

  async function getPair(sel) {
    let pair = null;
    try {
      const j = await noCache(DexPairUrl(sel.chain, sel.address));
      pair = j?.pairs?.[0] || null;
    } catch {}
    if (pair) return pair;

    const j = await noCache(DexTokenUrl(sel.address));
    const pairs = Array.isArray(j?.pairs) ? j.pairs : [];
    return pairs
      .filter(p => String(p.chainId || "").toLowerCase() === sel.chain.toLowerCase())
      .sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0))[0] || null;
  }

  const DexPairUrl = (chain, address) =>
    DEX + "/latest/dex/tokens/" + encodeURIComponent(address);
  const DexTokenUrl = (address) =>
    DEX + "/latest/dex/tokens/" + encodeURIComponent(address);

  async function seedLatestCandle(sel, pair, bucket) {
    if (historySeedKey === sel.key && liveCandle?.bucket === bucket) return;
    historySeedKey = sel.key;
    liveCandle = null;

    const networkMap = {
      ethereum: "eth", eth: "eth", bsc: "bsc", base: "base", solana: "solana",
      arbitrum: "arbitrum", optimism: "optimism", polygon: "polygon_pos",
      polygon_pos: "polygon_pos", avalanche: "avax", avax: "avax", fantom: "ftm",
      sonic: "sonic", sui: "sui", ton: "ton", aptos: "aptos", linea: "linea",
      blast: "blast", zksync: "zksync", scroll: "scroll", opbnb: "op_bnb",
      mantle: "mantle", cronos: "cronos"
    };
    const network = networkMap[String(sel.chain).toLowerCase()];
    if (network && pair?.pairAddress) {
      try {
        const tf = getTimeframe();
        const url = "https://api.geckoterminal.com/api/v2/networks/" +
          encodeURIComponent(network) + "/pools/" + encodeURIComponent(pair.pairAddress) +
          "/ohlcv/" + tf.tf + "?aggregate=" + encodeURIComponent(tf.aggregate) +
          "&limit=2&currency=usd";
        const j = await noCache(url);
        const rows = j?.data?.attributes?.ohlcv_list || [];
        const last = rows
          .map(r => ({ time: Number(r[0]), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]) }))
          .filter(c => c.time && c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0)
          .sort((a, b) => a.time - b.time)
          .pop();
        if (last) liveCandle = { bucket, ...last };
      } catch (e) {
        console.warn("Could not seed live candle from history", e);
      }
    }

    if (!liveCandle) {
      const p = Number(pair?.priceUsd || 0);
      const now = Math.floor(Date.now() / 1000);
      const time = Math.floor(now / bucket) * bucket;
      liveCandle = { bucket, time, open: p, high: p, low: p, close: p };
    }
  }

  function updateCandle(priceUsd, bucket) {
    if (typeof candleSeries === "undefined" || !candleSeries || !Number.isFinite(priceUsd) || priceUsd <= 0) return;
    const now = Math.floor(Date.now() / 1000);
    const time = Math.floor(now / bucket) * bucket;

    if (!liveCandle || liveCandle.bucket !== bucket || liveCandle.time !== time) {
      liveCandle = { bucket, time, open: priceUsd, high: priceUsd, low: priceUsd, close: priceUsd };
    } else {
      liveCandle = {
        ...liveCandle,
        close: priceUsd,
        high: Math.max(Number(liveCandle.high) || priceUsd, priceUsd),
        low: Math.min(Number(liveCandle.low) || priceUsd, priceUsd)
      };
    }

    try {
      candleSeries.update({
        time: liveCandle.time,
        open: liveCandle.open,
        high: liveCandle.high,
        low: liveCandle.low,
        close: liveCandle.close
      });
      applyPrecision(priceUsd);
      if (typeof priceChart !== "undefined" && priceChart) priceChart.timeScale().scrollToRealTime();
    } catch (e) {
      console.warn("Live candle render failed", e);
    }
  }

  function updateMeta(sel, pair, p) {
    const meta = document.querySelector("#chartMeta");
    if (meta) {
      const ch = Number(pair?.priceChange?.h24 || 0);
      meta.textContent = "LIVE ⚡ · " + sel.chain + " · " + price(p) +
        " · " + (ch >= 0 ? "+" : "") + ch.toFixed(2) + "% 24h · DEX live · " +
        new Date().toLocaleTimeString();
    }

    const facts = document.querySelector("#chartFacts");
    if (facts && typeof setupFor === "function") {
      const x = {
        priceUsd: p,
        change24h: Number(pair?.priceChange?.h24 || 0),
        volume24h: Number(pair?.volume?.h24 || 0),
        liquidityUsd: Number(pair?.liquidity?.usd || 0),
        buyPressure: Number((pair?.txns?.h24?.buys || 0)) + Number((pair?.txns?.h24?.sells || 0)) > 0
          ? Math.round(Number(pair.txns.h24.buys || 0) / (Number(pair.txns.h24.buys || 0) + Number(pair.txns.h24.sells || 0)) * 100)
          : 50,
        momentum: 50, fomo: 50, risk: "Medium", signal: "Watch",
        reasons: [], marketCap: Number(pair?.marketCap || pair?.fdv || 0)
      };
      const s = setupFor(x);
      const vals = [
        ["LIVE price", price(p)],
        ["24h volume", money(x.volume24h)],
        ["Liquidity", money(x.liquidityUsd)],
        ["Buy pressure", x.buyPressure + "%"],
        ["Entry zone", price(s.entryLow) + " – " + price(s.entryHigh)],
        ["Stop loss", price(s.stop)],
        ["Take profit 1", price(s.tp1)],
        ["Take profit 2 / 3", price(s.tp2) + " / " + price(s.tp3)]
      ];
      facts.innerHTML = vals.map(([k, v]) => '<div class="fact"><small>' + k + '</small><b>' + v + '</b></div>').join("");
    }
  }

  async function tick() {
    const sel = getSelected();
    if (!sel || typeof candleSeries === "undefined" || !candleSeries) return;
    if (sel.key !== activeKey) {
      activeKey = sel.key;
      historySeedKey = "";
      liveCandle = null;
    }

    const pair = await getPair(sel).catch(() => null);
    const p = Number(pair?.priceUsd || 0);
    if (!pair || !p) return;

    const tf = getTimeframe();
    await seedLatestCandle(sel, pair, tf.bucket);
    updateCandle(p, tf.bucket);
    lastPrice = p;
    updateMeta(sel, pair, p);

    const row = document.querySelector('.coin-row[data-key="' + CSS.escape(sel.key) + '"]');
    if (row) {
      const pe = row.querySelector(".coin-price");
      if (pe) pe.textContent = price(p);
      const ce = row.querySelector(".coin-change");
      if (ce) {
        const ch = Number(pair.priceChange?.h24 || 0);
        ce.textContent = (ch >= 0 ? "▲ +" : "▼ ") + ch.toFixed(2) + "%";
      }
    }
  }

  function start() {
    if (timer) return;
    tick();
    timer = setInterval(tick, POLL_MS);
  }

  function stopIfClosed() {
    if (!getSelectedKey() && timer) {
      clearInterval(timer);
      timer = null;
      activeKey = "";
      liveCandle = null;
      historySeedKey = "";
      lastPrice = 0;
    }
  }

  // The chart is created by app.js before this script can reliably wrap its
  // functions. A small observer therefore watches the actual selected row and
  // chart mount, making this updater independent of app.js implementation.
  const observer = new MutationObserver(() => {
    const selectedKey = getSelectedKey();
    if (selectedKey && document.querySelector("#chartMount")) start();
    else stopIfClosed();
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });

  document.addEventListener("click", () => setTimeout(() => {
    const selectedKey = getSelectedKey();
    if (selectedKey) start();
    else stopIfClosed();
  }, 150));

  window.addEventListener("beforeunload", () => { if (timer) clearInterval(timer); });
})();
