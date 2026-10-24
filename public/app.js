let data=[];
const $=x=>document.querySelector(x);
const esc=s=>String(s??"").replace(/[&<>\"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;","'":"&#39;"}[c]));
const money=n=>n>=1e9?"$"+(n/1e9).toFixed(2)+"B":n>=1e6?"$"+(n/1e6).toFixed(2)+"M":n>=1e3?"$"+(n/1e3).toFixed(1)+"K":"$"+Number(n||0).toFixed(0);
const price=n=>Number(n||0)>=1?"$"+Number(n).toFixed(4):"$"+Number(n||0).toPrecision(5);
const token=()=>localStorage.getItem("fomoToken");
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const SEARCHES=["meme","pepe","doge","inu","cat","frog","bonk","wif","shib","floki","moon","pump","ai","trump","sol","base","elon","dog","banana"];
const DEX="https://api.dexscreener.com";

function scorePair(x){
  const ch=Number(x.priceChange?.h24||0), vol=Number(x.volume?.h24||0), liq=Number(x.liquidity?.usd||0);
  const buys=Number(x.txns?.h24?.buys||0), sells=Number(x.txns?.h24?.sells||0), total=buys+sells;
  const ratio=total?buys/total:.5;
  const txBoost=Math.min(15,Math.log10(Math.max(total,1))*3);
  const volBoost=Math.min(22,Math.log10(Math.max(vol,1))*3);
  const liqRatio=vol/Math.max(liq,1);
  const momentum=Math.max(0,Math.min(100,Math.round(50+ch*1.15+(ratio-.5)*28+txBoost+Math.max(0,volBoost-6))));
  const fomo=Math.max(0,Math.min(100,Math.round(Math.min(38,Math.max(0,ch))*1.45+volBoost+Math.max(0,ratio-.5)*52+(liqRatio>3?15:liqRatio>1.5?8:0)+(Number(x.boosts?.active||0)>0?8:0))));
  const risk=liq<1e4?"Very High":liq<5e4?"High":liq<2.5e5?"Medium":"Lower";
  const signal=liq<5e4?"High Risk":momentum>=68?"Bullish":momentum<=38?"Bearish":"Watch";
  const age=x.pairCreatedAt?Math.max(0,(Date.now()-Number(x.pairCreatedAt))/3600000):null;
  const buyPressure=Math.round(ratio*100);
  const confidence=Math.max(52,Math.min(94,Math.round(50+Math.abs(momentum-50)*0.65+Math.min(15,Math.abs(ch))*0.8+(liq>=5e4?6:0))));
  let reasons=[];
  if(ch>=8) reasons.push("strong 24h price expansion"); else if(ch<=-8) reasons.push("weakening 24h price action");
  if(buyPressure>=58) reasons.push("buyers dominate sellers"); else if(buyPressure<=42) reasons.push("selling pressure dominates");
  if(vol>liq*2&&liq>0) reasons.push("volume is large relative to liquidity");
  if(vol<liq*.25&&liq>0) reasons.push("volume is still light versus liquidity");
  if(txBoost>=9) reasons.push("transaction activity is elevated");
  if(liq<5e4) reasons.push("thin liquidity increases execution risk");
  if(!reasons.length) reasons.push("mixed momentum and market activity");
  const prediction=signal==="Bullish"?"Bullish":signal==="Bearish"?"Bearish":signal==="High Risk"?"High Risk / Unclear":"Watch";
  return {name:x.baseToken?.name||"Unknown",symbol:x.baseToken?.symbol||"?",chain:x.chainId,address:x.baseToken?.address||"",url:x.url,priceUsd:Number(x.priceUsd||0),change24h:ch,volume24h:vol,liquidityUsd:liq,marketCap:Number(x.marketCap||x.fdv||0),buys,sells,txns:total,momentum,fomo,risk,signal,prediction,confidence,buyPressure,reasons,ageHours:age,boost:Number(x.boosts?.active||0),image:x.info?.imageUrl||""};
}

async function json(url){const r=await fetch(url,{headers:{Accept:"application/json"}});if(!r.ok)throw Error("Data source returned "+r.status);return r.json()}

async function loadUniverse(){
  const t=token();
  if(!t){$("#status").innerHTML='Please <a class="green" href="/login.html?next=%2F">log in</a> or create a free account to use the scanner. You get <b>10 free uses</b>.';return}
  $("#status").textContent="Scanning the multi-chain memecoin universe and building intelligence signals…";
  try{
    const gate=await fetch("/api/market?q=meme",{headers:{Authorization:"Bearer "+t}}), gateJson=await gate.json();
    if(gate.status===401){localStorage.removeItem("fomoToken");location.href="/login.html?next=%2F";return}
    if(gate.status===402){$("#status").innerHTML=`<b>${esc(gateJson.error||"Your free uses are finished.")}</b> <a class="green" href="/pricing.html">Choose Normal ($50) or VIP ($100)</a>`;return}
    if(!gate.ok)throw Error(gateJson.error||"Scanner access unavailable");
    const [boosts,profiles,...searchResults]=await Promise.all([
      json(DEX+"/token-boosts/latest/v1").catch(()=>[]),
      json(DEX+"/token-profiles/latest/v1").catch(()=>[]),
      ...SEARCHES.map(q=>json(DEX+"/latest/dex/search?q="+encodeURIComponent(q)).catch(()=>({pairs:[]})))
    ]);
    const byKey=new Map();
    const add=(x,source)=>{if(!x?.chainId||!x?.tokenAddress)return;const k=x.chainId+":"+x.tokenAddress.toLowerCase();const old=byKey.get(k);byKey.set(k,{chainId:x.chainId,tokenAddress:x.tokenAddress,url:x.url||old?.url,boost:Math.max(Number(x.amount||0),Number(old?.boost||0)),source:source||old?.source});};
    (Array.isArray(boosts)?boosts:[]).forEach(x=>add(x,"boost"));
    (Array.isArray(profiles)?profiles:[]).forEach(x=>add(x,"profile"));
    searchResults.forEach(r=>(r?.pairs||[]).forEach(x=>add({chainId:x.chainId,tokenAddress:x.baseToken?.address,url:x.url},"search")));
    const groups={};
    for(const x of byKey.values())(groups[x.chainId]??=[]).push(x.tokenAddress);
    const enriched=[];
    for(const [chain,addresses] of Object.entries(groups)){
      for(let i=0;i<addresses.length;i+=25){
        const batch=addresses.slice(i,i+25).join(",");
        try{
          const r=await json(`${DEX}/tokens/v1/${encodeURIComponent(chain)}/${encodeURIComponent(batch)}`);
          const pairs=Array.isArray(r)?r:(r?.pairs||[]);
          const best=new Map();
          for(const p of pairs){const k=(p.chainId||chain)+":"+(p.baseToken?.address||"").toLowerCase();if(!k.endsWith(":")){const prev=best.get(k);if(!prev||Number(p.liquidity?.usd||0)>Number(prev.liquidity?.usd||0))best.set(k,p)}}
          for(const p of best.values())enriched.push(scorePair(p));
        }catch{}
        if(i+25<addresses.length)await sleep(80);
      }
    }
    const fallback=(gateJson.pairs||[]).map(x=>scorePair(x));
    const merged=new Map();
    [...enriched,...fallback].forEach(x=>{const k=x.chain+":"+x.address.toLowerCase();const old=merged.get(k);if(!old||x.volume24h>old.volume24h)merged.set(k,x)});
    data=[...merged.values()].filter(x=>x.priceUsd>0).sort((a,b)=>b.fomo-a.fomo).slice(0,500);
    if(!data.length)throw Error("No live token data was returned");
    $("#status").innerHTML=(gateJson.paid?"Unlimited membership access":"Free uses remaining: <b>"+esc(gateJson.freeRemaining)+" / 10</b>")+` · <b>${data.length}</b> live candidates · evidence-based intelligence · Updated ${new Date().toLocaleTimeString()}`;
    $("#chain").innerHTML='<option value="">All chains</option>'+[...new Set(data.map(x=>x.chain))].sort().map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join("");
    render();
  }catch(e){console.error(e);$("#status").textContent=e.message||"Market feed unavailable"}
}

function render(){
  let q=$("#q").value.toLowerCase(),c=$("#chain").value,s=$("#sig").value,sort=$("#sort").value;
  let a=data.filter(x=>(!q||(x.name+x.symbol+x.address).toLowerCase().includes(q))&&(!c||x.chain===c)&&(!s||x.signal===s));
  a.sort((x,y)=>sort==="momentum"?y.momentum-x.momentum:sort==="volume"?y.volume24h-x.volume24h:sort==="change"?y.change24h-x.change24h:y.fomo-x.fomo);
  $("#count").textContent=a.length;$("#bull").textContent=a.filter(x=>x.signal==="Bullish").length;$("#fomo").textContent=a.filter(x=>x.fomo>=70).length;$("#risk").textContent=a.filter(x=>x.risk==="High"||x.risk==="Very High").length;
  $("#rows").innerHTML=a.slice(0,500).map(x=>`<tr><td><b>${esc(x.name)}</b> <span class="muted">${esc(x.symbol)}</span><br><small class="muted">${esc(x.address.slice(0,6))}…${esc(x.address.slice(-4))}</small><br><a href="${esc(x.url||"#")}" target="_blank" rel="noopener" class="green">View pair ↗</a></td><td>${esc(x.chain)}</td><td>${price(x.priceUsd)}</td><td class="${x.change24h>=0?'green':'red'}">${x.change24h>=0?'+':''}${x.change24h.toFixed(2)}%</td><td>${money(x.volume24h)}</td><td>${money(x.liquidityUsd)}</td><td>${money(x.marketCap)}</td><td><b>${x.fomo}</b></td><td><b>${x.momentum}</b></td><td class="${x.signal==='Bullish'?'green':x.signal==='High Risk'?'red':'yellow'}"><b>${esc(x.prediction)}</b><br><small>${x.confidence}% confidence · ${esc(x.risk)}</small><br><small title="${esc(x.reasons.join('; '))}">${esc(x.reasons.slice(0,2).join(' · '))}</small></td></tr>`).join("")||'<tr><td colspan="10">No matches.</td></tr>';
}

$("#refresh").onclick=loadUniverse;
["q","chain","sig","sort"].forEach(id=>$("#"+id).addEventListener("input",render));
loadUniverse();

function setupFor(x){
  const p=x.priceUsd;
  const buy=x.buyPressure;
  const quality=Math.max(0,Math.min(100,Math.round(38+x.momentum*.35+x.fomo*.18+Math.min(18,Math.log10(Math.max(x.liquidityUsd,1))*2)+(buy-50)*.25-(x.risk==="Very High"?24:x.risk==="High"?12:0))));
  const tradable=x.signal==="Bullish"&&x.momentum>=68&&x.fomo>=58&&buy>=55&&x.liquidityUsd>=50000&&x.change24h>0;
  const entryLow=p*(x.momentum>=78?0.985:0.97), entryHigh=p*(x.momentum>=78?1.005:1.015);
  const stop=p*(x.risk==="Lower"?0.93:x.risk==="Medium"?0.91:0.88);
  const tp1=p*1.10,tp2=p*1.20,tp3=p*1.35;
  const action=tradable?"ENTRY WATCH":"WAIT / NO ENTRY";
  const reasons=[...x.reasons];
  if(x.liquidityUsd>=250000)reasons.push("liquidity is comparatively strong");
  if(x.liquidityUsd<50000)reasons.push("liquidity is too thin for an entry screen");
  if(x.ageHours!=null&&x.ageHours<1)reasons.push("very new pair: extra launch risk");
  if(x.sells>x.buys)reasons.push("sells currently exceed buys");
  return {...x,quality,tradable,action,entryLow,entryHigh,stop,tp1,tp2,tp3,reasons:[...new Set(reasons)].slice(0,4)};
}

function renderTradeSetups(){
  const grid=$("#setupGrid"), next=$("#nextReview");
  if(!grid||!data.length)return;
  const ranked=data.map(setupFor).sort((a,b)=>((b.tradable?1000:0)+b.quality+b.momentum+b.fomo)-((a.tradable?1000:0)+a.quality+a.momentum+a.fomo)).slice(0,3);
  const now=new Date();
  const review=new Date(now.getTime()+15*60000);
  if(next)next.textContent=review.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
  grid.innerHTML=ranked.map(x=>`<div class="card"><div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><span class="eyebrow">${x.tradable?"TRADE CANDIDATE":"RISK FILTER"}</span><h3>${esc(x.name)} <span class="muted">${esc(x.symbol)}</span></h3><p class="muted">${esc(x.chain)} · Quality ${x.quality}/100 · ${x.confidence}% model confidence</p></div><b class="${x.tradable?'green':'yellow'}">${esc(x.action)}</b></div><div class="statline"><span>Current</span><b>${price(x.priceUsd)}</b></div><div class="statline"><span>Entry zone</span><b>${price(x.entryLow)} – ${price(x.entryHigh)}</b></div><div class="statline"><span>Stop / invalidation</span><b class="red">${price(x.stop)}</b></div><div class="statline"><span>TP1 / TP2 / TP3</span><b>${price(x.tp1)} / ${price(x.tp2)} / ${price(x.tp3)}</b></div><div class="statline"><span>Buy pressure</span><b>${x.buyPressure}%</b></div><p><b>Legit screen:</b> ${x.liquidityUsd>=50000?"PASS — sufficient public liquidity for this screen":"FAIL — thin liquidity"}; contract/honeypot/security checks remain <b>unverified</b>.</p><p class="muted"><b>Why:</b> ${esc(x.reasons.join(" · "))}</p><p class="muted"><b>Exit rule:</b> close if price hits invalidation, momentum falls below 55, or selling pressure overtakes buyers. Take partial profit at TP1/TP2 rather than waiting for a guaranteed clock time.</p><a href="${esc(x.url||"#")}" target="_blank" rel="noopener" class="green">Open live pair ↗</a></div>`).join("");
}

setInterval(renderTradeSetups,1000);
renderTradeSetups();