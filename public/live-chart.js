/* FOMOAI live chart stream: fresh market ticks + current-candle updates. */
(function(){
  const POLL_MS=1000;
  let timer=null, generation=0, busy=false;
  const liveJson=async url=>{const sep=url.includes("?")?"&":"?";const r=await fetch(url+sep+"_live="+Date.now(),{headers:{Accept:"application/json","Cache-Control":"no-cache","Pragma":"no-cache"},cache:"no-store"});if(!r.ok)throw Error("Live market returned "+r.status);return r.json()};
  const stop=()=>{generation++;if(timer){clearInterval(timer);timer=null}busy=false};
  const setMeta=(x,p)=>{const el=document.querySelector("#chartMeta");if(el)el.textContent="LIVE • "+x.chain+" · "+price(p)+" · "+(Number(x.change24h)>=0?"+":"")+Number(x.change24h||0).toFixed(2)+"% 24h · tick "+new Date().toLocaleTimeString()};
  const setFacts=(x,p)=>{const f=document.querySelector("#chartFacts");if(!f||typeof setupFor!=="function")return;const s=setupFor({...x,priceUsd:p});f.innerHTML=[["LIVE price",price(p)],["24h volume",money(x.volume24h)],["Liquidity",money(x.liquidityUsd)],["Buy pressure",x.buyPressure+"%"],["Entry zone",price(s.entryLow)+" – "+price(s.entryHigh)],["Stop loss",price(s.stop)],["Take profit 1",price(s.tp1)],["Take profit 2 / 3",price(s.tp2)+" / "+price(s.tp3)]].map(([k,v])=>'<div class="fact"><small>'+k+'</small><b>'+v+'</b></div>').join("")};
  async function getPair(x){
    let j=await liveJson(DEX+"/latest/dex/pairs/"+encodeURIComponent(x.chain)+"/"+encodeURIComponent(x.pairAddress)).catch(()=>null);
    let p=j?.pairs?.[0];
    if(!p&&x.address){
      j=await liveJson(DEX+"/latest/dex/tokens/"+encodeURIComponent(x.address)).catch(()=>null);
      const ps=Array.isArray(j?.pairs)?j.pairs:[];
      p=ps.filter(q=>String(q.chainId).toLowerCase()===String(x.chain).toLowerCase()).sort((a,b)=>Number(b.liquidity?.usd||0)-Number(a.liquidity?.usd||0))[0]||ps[0];
    }
    return p;
  }
  async function poll(x,myGen){
    if(busy||!x||!window.candleSeries||myGen!==generation)return;
    busy=true;
    try{
      const pair=await getPair(x), p=Number(pair?.priceUsd||0);
      if(!p)throw Error("No fresh price");
      const now=Math.floor(Date.now()/1000), bucket=activeTf==="hour"?(Number(activeAgg)||1)*3600:(Number(activeAgg)||5)*60;
      const bt=Math.floor(now/bucket)*bucket;
      let last=window.__fomoLiveLastCandle;
      if(!last||last.time!==bt){
        last={time:bt,open:p,high:p,low:p,close:p};
      }else{
        last={time:bt,open:Number(last.open)||p,high:Math.max(Number(last.high)||p,p),low:Math.min(Number(last.low)||p,p),close:p};
      }
      window.__fomoLiveLastCandle=last;
      try{window.candleSeries.update(last)}catch(e){
        console.warn("Re-syncing live candle",e);
        window.__fomoLiveLastCandle={time:bt,open:p,high:p,low:p,close:p};
        window.candleSeries.update(window.__fomoLiveLastCandle);
      }
      const fresh={...x,priceUsd:p,change24h:Number(pair.priceChange?.h24??x.change24h),volume24h:Number(pair.volume?.h24??x.volume24h),liquidityUsd:Number(pair.liquidity?.usd??x.liquidityUsd),pairAddress:pair.pairAddress||x.pairAddress};
      setMeta(fresh,p);setFacts(fresh,p);
      const idx=data.findIndex(z=>z.chain===x.chain&&z.address.toLowerCase()===x.address.toLowerCase());
      if(idx>=0){data[idx]=fresh;selected=data[idx]}
      const row=document.querySelector('.coin-row[data-key="'+CSS.escape(x.chain+":"+x.address)+'"]');
      if(row){const pe=row.querySelector('.coin-price'),ce=row.querySelector('.coin-change');if(pe)pe.textContent=price(p);if(ce){const ch=fresh.change24h;ce.textContent=(ch>=0?'▲ +':'▼ ')+Number(ch).toFixed(2)+'%';ce.classList.toggle('green',ch>=0);ce.classList.toggle('red',ch<0)}}
    }catch(e){console.warn("Live tick failed",e)}finally{busy=false}
  }
  const originalLoadCandles=window.loadCandles;
  window.loadCandles=async function(x){
    stop();window.__fomoLiveLastCandle=null;
    if(originalLoadCandles)await originalLoadCandles(x);
    if(selected&&selected.address.toLowerCase()===x.address.toLowerCase()&&selected.chain===x.chain&&window.candleSeries){
      const myGen=generation;await poll(x,myGen);timer=setInterval(()=>poll(selected,myGen),POLL_MS);
    }
  };
  document.addEventListener("click",e=>{
    if(e.target?.id==="closeChart")setTimeout(stop,0);
    if(e.target?.matches?.("[data-tf]"))setTimeout(()=>{if(selected&&window.candleSeries){stop();window.__fomoLiveLastCandle=null;const g=generation;poll(selected,g);timer=setInterval(()=>poll(selected,g),POLL_MS)}},300);
  });
  window.addEventListener("beforeunload",stop);
})();