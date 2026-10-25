let data=[];let activeSort="fomo";let selected=null;
const $=x=>document.querySelector(x);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money=n=>n>=1e9?"$"+(n/1e9).toFixed(2)+"B":n>=1e6?"$"+(n/1e6).toFixed(2)+"M":n>=1e3?"$"+(n/1e3).toFixed(1)+"K":"$"+Number(n||0).toFixed(0);
const price=n=>Number(n||0)>=1?"$"+Number(n).toFixed(4):"$"+Number(n||0).toPrecision(5);
const token=()=>localStorage.getItem("fomoToken");const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const SEARCHES=["meme","pepe","doge","inu","cat","frog","bonk","wif","shib","floki","moon","pump","ai","trump","sol","base","elon","dog","banana"];const DEX="https://api.dexscreener.com";
function scorePair(x){
 const ch=Number(x.priceChange?.h24||0),vol=Number(x.volume?.h24||0),liq=Number(x.liquidity?.usd||0);
 const buys=Number(x.txns?.h24?.buys||0),sells=Number(x.txns?.h24?.sells||0),total=buys+sells,ratio=total?buys/total:.5;
 const txBoost=Math.min(15,Math.log10(Math.max(total,1))*3),volBoost=Math.min(22,Math.log10(Math.max(vol,1))*3),liqRatio=vol/Math.max(liq,1);
 const momentum=Math.max(0,Math.min(100,Math.round(50+ch*1.15+(ratio-.5)*28+txBoost+Math.max(0,volBoost-6))));
 const fomo=Math.max(0,Math.min(100,Math.round(Math.min(38,Math.max(0,ch))*1.45+volBoost+Math.max(0,ratio-.5)*52+(liqRatio>3?15:liqRatio>1.5?8:0)+(Number(x.boosts?.active||0)>0?8:0))));
 const risk=liq<1e4?"Very High":liq<5e4?"High":liq<2.5e5?"Medium":"Lower";
 const signal=liq<5e4?"High Risk":momentum>=68?"Bullish":momentum<=38?"Bearish":"Watch";
 const age=x.pairCreatedAt?Math.max(0,(Date.now()-Number(x.pairCreatedAt))/3600000):null,buyPressure=Math.round(ratio*100);
 const confidence=Math.max(52,Math.min(94,Math.round(50+Math.abs(momentum-50)*.65+Math.min(15,Math.abs(ch))*.8+(liq>=5e4?6:0))));
 const reasons=[];
 if(ch>=8)reasons.push("strong 24h price expansion");else if(ch<=-8)reasons.push("weakening 24h price action");
 if(buyPressure>=58)reasons.push("buyers dominate sellers");else if(buyPressure<=42)reasons.push("selling pressure dominates");
 if(vol>liq*2&&liq>0)reasons.push("volume is large relative to liquidity");
 if(txBoost>=9)reasons.push("transaction activity is elevated");
 if(liq<5e4)reasons.push("thin liquidity increases execution risk");
 if(!reasons.length)reasons.push("mixed momentum and market activity");
 return {name:x.baseToken?.name||"Unknown",symbol:x.baseToken?.symbol||"?",chain:x.chainId,address:x.baseToken?.address||"",pairAddress:x.pairAddress||"",url:x.url,priceUsd:Number(x.priceUsd||0),change24h:ch,volume24h:vol,liquidityUsd:liq,marketCap:Number(x.marketCap||x.fdv||0),buys,sells,txns:total,momentum,fomo,risk,signal,prediction:signal==="Bullish"?"Bullish":signal==="Bearish"?"Bearish":signal==="High Risk"?"High Risk / Unclear":"Watch",confidence,buyPressure,reasons,ageHours:age,boost:Number(x.boosts?.active||0),image:x.info?.imageUrl||""};
}
async function json(url){const r=await fetch(url,{headers:{Accept:"application/json"}});if(!r.ok)throw Error("Data source returned "+r.status);return r.json()}
async function loadUniverse(){
 const t=token();
 if(!t){$("#status").innerHTML='Please <a class="green" href="/login?next=%2F">log in</a> or create a free account.';return}
 $("#status").textContent="Discovering live memecoins across supported chains…";
 try{
  const gate=await fetch("/api/market?q=solana",{headers:{Authorization:"Bearer "+t}});
  const gj=await gate.json();
  if(gate.status===401){localStorage.removeItem("fomoToken");location.href="/login?next=%2F";return}
  if(gate.status===402){$("#status").innerHTML='<b>'+esc(gj.error||"Free uses finished.")+'</b> <a href="/pricing.html">View plans</a>';return}
  if(!gate.ok)throw Error(gj.error||"Scanner access unavailable");
  const searches=["solana","solana meme","solana memecoin","pump.fun","pumpfun","raydium","bonk","wif","dogwifhat","pump","pepe","doge","inu","cat","frog","moon","ai","trump","meme coin","memecoin","new pair","launch","degen","based","brett","mog","popcat","bome","myro","mew","wen","giga","goat","act","fwog","mother","retardio","slerf"," ponke","ethereum meme","base meme","bnb meme","shiba","floki","turbo","toshi","higher","aero"];
  const [boosts,topBoosts,profiles,takeovers,...searchResults]=await Promise.all([
   json(DEX+"/token-boosts/latest/v1").catch(()=>[]),
   json(DEX+"/token-boosts/top/v1").catch(()=>[]),
   json(DEX+"/token-profiles/latest/v1").catch(()=>[]),
   json(DEX+"/community-takeovers/latest/v1").catch(()=>[]),
   ...searches.map(q=>json(DEX+"/latest/dex/search?q="+encodeURIComponent(q.trim())).catch(()=>({pairs:[]})))
  ]);
  const byKey=new Map();
  const add=x=>{if(x?.chainId&&x?.tokenAddress)byKey.set(x.chainId+":"+x.tokenAddress.toLowerCase(),{chainId:x.chainId,tokenAddress:x.tokenAddress,url:x.url})};
  [boosts,topBoosts,profiles,takeovers].forEach(list=>(Array.isArray(list)?list:[]).forEach(add));
  searchResults.forEach(r=>(r?.pairs||[]).forEach(x=>add({chainId:x.chainId,tokenAddress:x.baseToken?.address,url:x.url})));
  const candidates=[...byKey.values()].sort((a,b)=>(b.chainId==="solana")-(a.chainId==="solana"));
  const groups={};for(const x of candidates)(groups[x.chainId]??=[]).push(x.tokenAddress);
  const enriched=[],jobs=[];
  for(const [chain,addresses] of Object.entries(groups)){
   const cap=chain==="solana"?750:250;
   for(let i=0;i<Math.min(addresses.length,cap);i+=25)jobs.push({chain,addresses:addresses.slice(i,i+25)});
  }
  const results=await Promise.all(jobs.map(async job=>{try{return await json(DEX+"/tokens/v1/"+encodeURIComponent(job.chain)+"/"+encodeURIComponent(job.addresses.join(",")))}catch{return []}}));
  results.forEach((pairs,i)=>{
   const chain=jobs[i].chain,best=new Map();
   for(const p of Array.isArray(pairs)?pairs:[]){
    const k=(p.chainId||chain)+":"+(p.baseToken?.address||"").toLowerCase();
    if(!k.endsWith(":")){const old=best.get(k);if(!old||Number(p.liquidity?.usd||0)>Number(old.liquidity?.usd||0))best.set(k,p)}
   }
   for(const p of best.values())enriched.push(scorePair(p));
  });
  const merged=new Map();
  [...enriched,...(gj.pairs||[]).map(scorePair)].forEach(x=>{const k=x.chain+":"+x.address.toLowerCase(),old=merged.get(k);if(!old||x.volume24h>old.volume24h)merged.set(k,x)});
  data=[...merged.values()].filter(x=>x.priceUsd>0).sort((a,b)=>(b.chain==="solana")-(a.chain==="solana")||b.fomo-a.fomo).slice(0,1000);
  if(!data.length)throw Error("No live token data was returned. Tap refresh to retry.");
  $("#status").innerHTML=(gj.paid?"Unlimited membership access":"Free uses remaining: <b>"+esc(gj.freeRemaining)+" / 10</b>")+" · "+data.length+" discovered live pairs · Solana prioritized · updated "+new Date().toLocaleTimeString()+"<br><small>Feeds cover tokens found by public market sources; no single API lists every token.</small>";
  $("#chain").innerHTML='<option value="">All chains</option>'+[...new Set(data.map(x=>x.chain))].sort((a,b)=>(a==="solana"?-1:b==="solana"?1:a.localeCompare(b))).map(x=>'<option value="'+esc(x)+'">'+(x==="solana"?"Solana":esc(x))+'</option>').join("");
  render();renderTradeSetups();loadTraderLeaderboard(t)
 }catch(e){console.error(e);$("#status").textContent=(e.message||"Market feed unavailable")+" — tap ↻ to retry."}
}
function render(){
 let q=$("#q").value.toLowerCase(),c=$("#chain").value,s=$("#sig").value,sort=$("#sort").value;
 let a=data.filter(x=>(!q||(x.name+x.symbol+x.address).toLowerCase().includes(q))&&(!c||x.chain===c)&&(!s||x.signal===s));
 a.sort((x,y)=>sort==="momentum"?y.momentum-x.momentum:sort==="volume"?y.volume24h-x.volume24h:sort==="change"?y.change24h-x.change24h:y.fomo-x.fomo);
 $("#coinFeed").innerHTML=a.slice(0,500).map(x=>'<article class="coin-row '+(selected?.address===x.address&&selected?.chain===x.chain?'selected':'')+'" data-key="'+esc(x.chain+":"+x.address)+'"><div class="coin-left"><div class="coin-logo '+(!x.image?'fallback':'')+'">'+(x.image?'<img src="'+esc(x.image)+'" alt="" class="coin-logo" onerror="this.outerHTML=\'<div class=&quot;coin-logo fallback&quot;>'+esc(x.symbol.slice(0,2))+'</div>\'">':esc(x.symbol.slice(0,2)))+'</div><div class="coin-copy"><div class="coin-title">'+esc(x.name)+' <span class="coin-chain">'+esc(x.chain)+'</span></div><div class="coin-sub">'+esc(x.symbol)+' · MC '+money(x.marketCap)+' · Vol '+money(x.volume24h)+'</div><div class="coin-extra"><span class="pill '+(x.signal==="Bullish"?"bull":x.signal==="High Risk"?"risk":"")+'">'+esc(x.signal)+'</span><span class="pill">FOMO '+x.fomo+'</span><span class="pill">Liq '+money(x.liquidityUsd)+'</span></div><div class="coin-links"><a href="'+esc(x.url||"#")+'" target="_blank" rel="noopener" onclick="event.stopPropagation()">DexScreener ↗</a>'+'<a href="#setups" class="fomo-trade-link" data-fomo-key="'+esc(x.chain+":"+x.address.toLowerCase())+'">Trade on FOMOAI ↗</a>'+(x.chain==="solana"&&x.address?'<a href="https://axiom.trade/t/'+encodeURIComponent(x.address)+'" target="_blank" rel="noopener" onclick="event.stopPropagation()">Trade on Axiom ↗</a>':'')+'</div></div></div><div class="coin-right"><div class="coin-price">'+price(x.priceUsd)+'</div><div class="coin-change '+(x.change24h>=0?'green':'red')+'">'+(x.change24h>=0?'▲ +':'▼ ')+x.change24h.toFixed(2)+'%</div></div></article>').join("")||'<p class="muted">No tokens match these filters.</p>';
 $("#coinFeed").querySelectorAll(".coin-row").forEach(el=>el.onclick=()=>{const [chain,address]=el.dataset.key.split(":");const x=data.find(z=>z.chain===chain&&z.address.toLowerCase()===address.toLowerCase());if(x)showChart(x)});
 $("#coinFeed").querySelectorAll(".fomo-trade-link").forEach(el=>el.onclick=e=>{e.preventDefault();e.stopPropagation();const x=data.find(z=>z.chain+":"+z.address.toLowerCase()===el.dataset.fomoKey);if(x)showChart(x);$("#setups").scrollIntoView({behavior:"smooth",block:"start"})});
}
let activeTf="minute",activeAgg="5",priceChart=null,candleSeries=null,chartResizeObserver=null;
const NETWORKS={ethereum:"eth",eth:"eth",bsc:"bsc",base:"base",solana:"solana",arbitrum:"arbitrum",optimism:"optimism",polygon:"polygon_pos",polygon_pos:"polygon_pos",avalanche:"avax",avax:"avax",fantom:"ftm",sonic:"sonic",sui:"sui",ton:"ton",aptos:"aptos",linea:"linea",blast:"blast",zksync:"zksync",scroll:"scroll",opbnb:"op_bnb",mantle:"mantle",cronos:"cronos"};
function renderMarkedChart(x,ohlcv){
 const mount=$("#chartMount");mount.innerHTML="";
 if(!window.LightweightCharts){mount.innerHTML='<div class="chart-placeholder">Chart library unavailable. <a href="'+esc(x.url||"#")+'" target="_blank" rel="noopener">Open live pair ↗</a></div>';return}
 if(priceChart){try{priceChart.remove()}catch{}priceChart=null}
 priceChart=LightweightCharts.createChart(mount,{width:mount.clientWidth,height:mount.clientHeight,layout:{background:{color:"#090711"},textColor:"#a49bb5"},grid:{vertLines:{color:"#191424"},horzLines:{color:"#191424"}},rightPriceScale:{borderColor:"#292135"},timeScale:{borderColor:"#292135",timeVisible:true,secondsVisible:false},crosshair:{mode:LightweightCharts.CrosshairMode.Normal}});
 candleSeries=priceChart.addCandlestickSeries({upColor:"#15c978",downColor:"#ff624f",borderVisible:false,wickUpColor:"#15c978",wickDownColor:"#ff624f"});
 candleSeries.setData(ohlcv);
 const s=setupFor(x), levels=[
 {price:s.entryLow,color:"#7cfc9b",title:"ENTRY"},
 {price:s.stop,color:"#ff6b62",title:"STOP"},
 {price:s.tp1,color:"#aa9aff",title:"TP1"},
 {price:s.tp2,color:"#aa9aff",title:"TP2"},
 {price:s.tp3,color:"#aa9aff",title:"TP3"}];
 levels.forEach(l=>{if(Number.isFinite(l.price)&&l.price>0)candleSeries.createPriceLine({price:l.price,color:l.color,lineWidth:2,lineStyle:LightweightCharts.LineStyle.Dashed,axisLabelVisible:true,title:l.title})});
 const last=ohlcv[ohlcv.length-1];if(last)candleSeries.setMarkers([{time:last.time,position:"belowBar",color:"#7cfc9b",shape:"arrowUp",text:"ENTRY ZONE"},{time:last.time,position:"aboveBar",color:"#ff6b62",shape:"arrowDown",text:"STOP "+price(s.stop)},{time:last.time,position:"aboveBar",color:"#aa9aff",shape:"circle",text:"TP1 "+price(s.tp1)}]);
 priceChart.timeScale().fitContent();
 if(chartResizeObserver)chartResizeObserver.disconnect();
 if(window.ResizeObserver){chartResizeObserver=new ResizeObserver(()=>{if(priceChart)priceChart.applyOptions({width:mount.clientWidth,height:mount.clientHeight})});chartResizeObserver.observe(mount)}
}
async function showChart(x){
 selected=x;$("#chartName").textContent=x.name+" ("+x.symbol+")";$("#chartMeta").textContent=x.chain+" · "+price(x.priceUsd)+" · "+(x.change24h>=0?"+":"")+x.change24h.toFixed(2)+"% in 24h";$("#closeChart").hidden=false;
 $("#chartMount").innerHTML='<div class="chart-placeholder">Loading candle data and calculating levels…</div>';
 $("#chartFacts").innerHTML=[["Market cap",money(x.marketCap)],["24h volume",money(x.volume24h)],["Liquidity",money(x.liquidityUsd)],["Buy pressure",x.buyPressure+"%"],["Entry zone",price(setupFor(x).entryLow)+" – "+price(setupFor(x).entryHigh)],["Stop loss reference",price(setupFor(x).stop)],["Take profit 1",price(setupFor(x).tp1)],["Take profit 2 / 3",price(setupFor(x).tp2)+" / "+price(setupFor(x).tp3)]].map(([k,v])=>'<div class="fact"><small>'+k+'</small><b>'+v+'</b></div>').join("");
 $("#coinFeed").querySelectorAll(".coin-row").forEach(el=>el.classList.toggle("selected",el.dataset.key===x.chain+":"+x.address));
 $("#chartSection").scrollIntoView({behavior:"smooth",block:"start"});
 await loadCandles(x);
}
async function loadCandles(x){
 const network=NETWORKS[String(x.chain||"").toLowerCase()];
 if(!network||!x.pairAddress){$("#chartMount").innerHTML='<div class="chart-placeholder">Candlestick history is not available for this pair on the selected data source. <a href="'+esc(x.url||"#")+'" target="_blank" rel="noopener">Open live pair ↗</a></div>';return}
 try{
 const url="https://api.geckoterminal.com/api/v2/networks/"+encodeURIComponent(network)+"/pools/"+encodeURIComponent(x.pairAddress)+"/ohlcv/"+activeTf+"?aggregate="+encodeURIComponent(activeAgg)+"&limit=120&currency=usd";
 const result=await json(url),rows=result?.data?.attributes?.ohlcv_list||[];
 const candles=rows.map(r=>({time:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4])})).filter(c=>c.time&&c.open>0&&c.high>0&&c.low>0&&c.close>0).sort((a,b)=>a.time-b.time);
 if(!candles.length)throw Error("No candle history returned");
 renderMarkedChart(x,candles);
 }catch(e){console.warn("Candle history unavailable",e);$("#chartMount").innerHTML='<div class="chart-placeholder">Candle history unavailable for this pool right now. Try another timeframe or <a href="'+esc(x.url||"#")+'" target="_blank" rel="noopener">open the pair on DexScreener ↗</a>.</div>'}
}
document.querySelectorAll("[data-tf]").forEach(b=>b.onclick=()=>{activeTf=b.dataset.tf;activeAgg=b.dataset.agg;document.querySelectorAll("[data-tf]").forEach(z=>z.classList.toggle("active",z===b));if(selected)loadCandles(selected)});

$("#closeChart").onclick=()=>{selected=null;$("#chartName").textContent="Choose a token";$("#chartMeta").textContent="Tap any coin above to open its chart.";$("#chartMount").innerHTML='<div class="chart-placeholder">Live price chart appears here when you select a token.</div>';$("#chartFacts").innerHTML="";$("#closeChart").hidden=true;if(priceChart){priceChart.remove();priceChart=null}render()};
$("#refresh").onclick=loadUniverse;["q","chain","sig","sort"].forEach(id=>$("#"+id).addEventListener("input",render));document.querySelectorAll("[data-sort]").forEach(b=>b.onclick=()=>{activeSort=b.dataset.sort;$("#sort").value=activeSort;document.querySelectorAll("[data-sort]").forEach(z=>z.classList.toggle("active",z===b));render()});
function setupFor(x){
 const p=x.priceUsd,buy=x.buyPressure;
 const quality=Math.max(0,Math.min(100,Math.round(38+x.momentum*.35+x.fomo*.18+Math.min(18,Math.log10(Math.max(x.liquidityUsd,1))*2)+(buy-50)*.25-(x.risk==="Very High"?24:x.risk==="High"?12:0))));
 const tradable=x.signal==="Bullish"&&x.momentum>=68&&x.fomo>=58&&buy>=55&&x.liquidityUsd>=50000&&x.change24h>0;
 return {...x,quality,tradable,action:tradable?"ENTRY WATCH":"WAIT / NO ENTRY",entryLow:p*(x.momentum>=78?.985:.97),entryHigh:p*(x.momentum>=78?1.005:1.015),stop:p*(x.risk==="Lower"?.93:x.risk==="Medium"?.91:.88),tp1:p*1.10,tp2:p*1.20,tp3:p*1.35,reasons:[...x.reasons,...(x.liquidityUsd<50000?["thin liquidity"]:[])].slice(0,4)};
}
function renderTradeSetups(){const grid=$("#setupGrid");if(!grid||!data.length)return;const ranked=data.map(setupFor).sort((a,b)=>((b.tradable?1000:0)+b.quality+b.momentum+b.fomo)-((a.tradable?1000:0)+a.quality+a.momentum+a.fomo)).slice(0,3);$("#nextReview").textContent=new Date(Date.now()+15*60000).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});grid.innerHTML=ranked.map(x=>'<div class="card"><span class="eyebrow">'+(x.tradable?"TRADE CANDIDATE":"RISK FILTER")+'</span><h3>'+esc(x.name)+' ('+esc(x.symbol)+')</h3><p>'+esc(x.chain)+' · Quality '+x.quality+'/100 · '+x.confidence+'% model confidence</p><div class="statline"><span>Current</span><b>'+price(x.priceUsd)+'</b></div><div class="statline"><span>Entry zone</span><b>'+price(x.entryLow)+' – '+price(x.entryHigh)+'</b></div><div class="statline"><span>Stop / invalidation</span><b class="red">'+price(x.stop)+'</b></div><div class="statline"><span>TP1 / TP2 / TP3</span><b>'+price(x.tp1)+' / '+price(x.tp2)+' / '+price(x.tp3)+'</b></div><div class="statline"><span>Buy pressure</span><b>'+x.buyPressure+'%</b></div><p><b>Safety:</b> '+(x.liquidityUsd>=50000?"sufficient public liquidity for this screen":"thin liquidity")+'; contract/honeypot checks remain unverified.</p><p><b>Why:</b> '+esc(x.reasons.join(" · "))+'</p><p>Review if momentum weakens or selling pressure overtakes buyers. Targets and stops are estimates, not guaranteed outcomes.</p><a class="green" href="'+esc(x.url||"#")+'" target="_blank" rel="noopener">Open live pair ↗</a></div>').join("")}
async function loadTraderLeaderboard(authToken=token()){
 const rows=$("#traderRows"),status=$("#traderStatus"),period=$("#traderWindow")?.value||"30d";
 if(!rows||!status)return;
 status.textContent="Loading public Solana trader rankings…";
 rows.innerHTML='<tr><td colspan="5">Loading trader data…</td></tr>';
 try{
  const r=await fetch("/api/traders?window="+encodeURIComponent(period),{headers:{Authorization:"Bearer "+authToken},cache:"no-store"});
  const payload=await r.json();
  if(r.status===401){localStorage.removeItem("fomoToken");location.href="/login?next=%2F";return}
  if(!r.ok)throw Error(payload.error||"Trader leaderboard unavailable");
  const traders=Array.isArray(payload.traders)?payload.traders:[];
  if(!traders.length)throw Error("No trader rows were returned by the data provider.");
  const fmtUsd=n=>{const v=Number(n||0);return (v<0?"−":"+")+"$"+Math.abs(v).toLocaleString(undefined,{maximumFractionDigits:0})};
  rows.innerHTML=traders.slice(0,100).map((x,i)=>{
   const wallet=String(x.address||x.walletAddress||x.wallet||"");
   const handle=x.handle||x.username||x.displayName||("Trader "+(x.rank||i+1));
   const pnl=x.realizedPnlUsd??x.realizedPnl??x.pnlUsd??x.pnl;
   const ret=x.returnPct??x.roiPct;
   const rank=Number(x.rank||i+1);
   return '<tr><td><span class="trader-name">#'+rank+' '+esc(handle)+'</span><span class="trader-handle">'+esc(x.displayName&&x.displayName!==handle?"@"+handle:(x.identityConfidence?"Verified identity":"Public wallet ranking"))+'</span></td><td class="'+(Number(pnl)>=0?"trader-pnl-positive":"trader-pnl-negative")+'">'+(pnl==null?"—":fmtUsd(pnl))+'</td><td>'+(ret==null?"—":(Number(ret)>=0?"+":"")+Number(ret).toFixed(1)+"%")+'</td><td>'+Number(x.trades||0).toLocaleString()+'</td><td>'+(wallet?'<a class="trader-wallet" target="_blank" rel="noopener" href="https://solscan.io/account/'+encodeURIComponent(wallet)+'">'+esc(wallet.slice(0,4)+"…"+wallet.slice(-4))+' ↗</a>':'—')+'</td></tr>'
  }).join("");
  status.textContent="Showing "+traders.length+" public Solana trader"+(traders.length===1?"":"s")+" · "+period+" realized PnL"+(payload.capturedAt?" · data captured "+new Date(payload.capturedAt).toLocaleString():"")+".";
  if(!payload.fullLeaderboardEnabled)status.innerHTML+=" <span class=\"muted\">Public mode is limited to 10 rows. Configure FOMO_TRADER_API_KEY in Render to enable up to 100.</span>";
 }catch(e){console.error(e);status.textContent=e.message||"Trader leaderboard unavailable";rows.innerHTML='<tr><td colspan="5">Could not load the leaderboard. Use the Axiom Top 100 link below to view its live trader page.</td></tr>'}
}
$("#traderWindow")?.addEventListener("change",()=>loadTraderLeaderboard());

loadUniverse();