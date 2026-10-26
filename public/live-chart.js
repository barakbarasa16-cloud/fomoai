/* FOMOAI realtime chart engine.
   The public DexScreener REST API is a snapshot feed, not a candle stream. The
   DexScreener chart embed is the supported realtime chart surface, so FOMOAI
   mounts the exact selected pair inside our chart panel. */
(function () {
  const DEX = "https://api.dexscreener.com";
  let activeKey = "";
  let pairAddress = "";
  let timer = null;

  const noCache = async (url) => {
    const sep = url.includes("?") ? "&" : "?";
    const r = await fetch(url + sep + "_live=" + Date.now(), {
      cache: "no-store",
      headers: { Accept: "application/json", "Cache-Control": "no-cache", Pragma: "no-cache" }
    });
    if (!r.ok) throw new Error("Market source returned " + r.status);
    return r.json();
  };

  const selected = () => {
    const row = document.querySelector("#coinFeed .coin-row.selected");
    const key = row?.dataset?.key || "";
    const i = key.indexOf(":");
    if (i < 1) return null;
    return { chain: key.slice(0, i), address: key.slice(i + 1), key };
  };

  const timeframe = () => {
    const b = document.querySelector("[data-tf].active") || document.querySelector("[data-tf]");
    const tf = b?.dataset?.tf === "hour" ? "hour" : "minute";
    const agg = Math.max(1, Number(b?.dataset?.agg || 1));
    return tf === "hour" ? String(agg * 60) : String(agg);
  };

  async function findPair(sel) {
    try {
      const j = await noCache(DEX + "/latest/dex/tokens/" + encodeURIComponent(sel.address));
      const pairs = Array.isArray(j?.pairs) ? j.pairs : [];
      return pairs
        .filter(p => String(p.chainId || "").toLowerCase() === sel.chain.toLowerCase())
        .sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0))[0] || null;
    } catch {
      return null;
    }
  }

  function embedUrl(chain, pair) {
    const params = new URLSearchParams({
      embed: "1",
      loadChartSettings: "0",
      trades: "0",
      info: "0",
      chartLeftToolbar: "0",
      chartTheme: "dark",
      theme: "dark",
      chartStyle: "1",
      interval: timeframe(),
      chartType: "price"
    });
    return "https://dexscreener.com/" + encodeURIComponent(chain) + "/" + encodeURIComponent(pair) + "?" + params.toString();
  }

  function renderEmbed(sel, pair) {
    const mount = document.querySelector("#chartMount");
    if (!mount || !pair?.pairAddress) return;
    pairAddress = pair.pairAddress;
    mount.innerHTML = "";
    const frame = document.createElement("iframe");
    frame.title = "FOMOAI realtime trading chart";
    frame.src = embedUrl(sel.chain, pair.pairAddress);
    frame.loading = "eager";
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.allow = "clipboard-write";
    frame.style.width = "100%";
    frame.style.height = "100%";
    frame.style.minHeight = "420px";
    frame.style.border = "0";
    frame.style.borderRadius = "12px";
    mount.appendChild(frame);
  }

  function updateMeta(sel, pair) {
    const p = Number(pair?.priceUsd || 0);
    const ch = Number(pair?.priceChange?.h24 || 0);
    const meta = document.querySelector("#chartMeta");
    if (meta) meta.textContent = "LIVE ⚡ · " + sel.chain + " · " + (p ? price(p) : "—") + " · " + (ch >= 0 ? "+" : "") + ch.toFixed(2) + "% 24h · DEX live · " + new Date().toLocaleTimeString();
  }

  async function refresh() {
    const sel = selected();
    const mount = document.querySelector("#chartMount");
    if (!sel || !mount) return;
    const key = sel.key + ":" + timeframe();
    const pair = await findPair(sel);
    if (!pair) return;
    updateMeta(sel, pair);
    if (key !== activeKey || pair.pairAddress !== pairAddress) {
      activeKey = key;
      renderEmbed(sel, pair);
    }
  }

  function start() {
    if (timer) return;
    refresh();
    // Refresh metadata/pair selection without rebuilding the iframe unless the
    // selected token or timeframe changes. The iframe itself supplies live candles.
    timer = setInterval(refresh, 5000);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    activeKey = "";
    pairAddress = "";
  }

  const observer = new MutationObserver(() => {
    if (selected() && document.querySelector("#chartMount")) start();
    else stop();
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });

  document.addEventListener("click", () => setTimeout(() => {
    if (selected()) start();
    else stop();
  }, 200));

  window.addEventListener("beforeunload", stop);
})();
