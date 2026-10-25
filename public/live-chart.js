/* FOMOAI live chart updater. Uses fresh market snapshots and updates the current candle without rewriting chart history. */
(function(){
  const POLL_MS=2000;
  let timer=null;
  let generation=0;
  const liveJson=async url=>{const sep=url.includes("?")?"&":"?";const r=await fetch(url+sep+"_live="+Date.now(),{headers:{Accept:"application/json","Cache-Control":"no-cache"},cache:"no-store"});if(!r.ok)throw Error("Live market returned "+r.status);return r.json()};
  const stop=()=>{generation++;if(timer){clearInterval(timer);timer=null}};
  const updateMeta=(x,p)=>{const el=document.querySelector("#chartMeta");if(el&&x)el.textContent="LIVE • "+x.chain+" · "+price(p)+" · "+(Number(x.change24h)>=0?"+":"")+Number(x.change24h||0).toFixed(2)+"% in 24h · updated "+new Date().toLocaleTimeString()};
  const updateFacts=(x,p)=>{const f=document.querySelector("#chartFacts");if(!f||!x||typeof setupFor!=="function")return;const s=setupFor({...x,priceUsd:p});f.innerHTML=[["Live price",price(p)],["24h volume",money(x.volume24h)],["Liquidity",money(x.liquidityUsd)],["Buy pressure",x.buyPressure+"%"],["Entry zone",price(s.entryLow)+" – "+price(s.entryHigh)],["Stop loss reference",price(s.stop)],["Take profit 1",price(s.tp1)],["Take profit 2 / 3",price(s.tp2)+" / "+price(s.tp3)]].map(([k,v])=>'<div class="fact"><small>'+k+'</small><b>'+v+'</b></div>').join("")};
  const poll=async(x,tokenGeneration)=>{
    if(!x||!candleSeries||tokenGeneration!==generation)return;
    try{
      const network=NETWORKS[String(x.chain||"").toLowerCase()];
      if(!network||!x.pairAddress)return;
      const payload=await liveJson(DEX+"/latest/dex/pairs/"+encodeURIComponent(x.chain)+"/"+encodeURIComponent(x.pairAddress));
      const pair=payload?.pairs?.[0],livePrice=Number(pair?.priceUsd||0);
      if(!livePrice)return;
      const now=Math.floor(Date.now()/1000);
      const bucket=activeTf==="hour"?(Number(activeAgg)||1)*3600:(Number(activeAgg)||5)*60;
      const currentBucket=Math.floor(now/bucket)*bucket;
      let last=window.__fomoLiveLastCandle||null;
      if(!last||last.time!==currentBucket){
        try{
          const chartData=await liveJson("https://api.geckoterminal.com/api/v2/networks/"+encodeURIComponent(network)+"/pools/"+encodeURIComponent(x.pairAddress)+"/ohlcv/"+activeTf+"?aggregate="+encodeURIComponent(activeAgg)+"&limit=20&currency=usd");
          const rows=chartData?.data?.attributes?.ohlcv_list||[];
          const usable=rows.map(r=>({time:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4])})).filter(r=>Number.isFinite(r.time)&&Number.isFinite(r.close));
          const exact=usable.find(r=>r.time===currentBucket);
          const latest=usable.reduce((a,b)=>!a||b.time>a.time?b:a,null);
          if(exact)last={...exact};
          else if(latest&&latest.time<=currentBucket)last={time:currentBucket,open:latest.close,high:Math.max(latest.close,livePrice),low:Math.min(latest.close,livePrice),close:livePrice};
          else last={time:currentBucket,open:livePrice,high:livePrice,low:livePrice,close:livePrice};
        }catch{last={time:currentBucket,open:livePrice,high:livePrice,low:livePrice,close:livePrice}}
      }else{
        last={time:currentBucket,open:last.open,high:Math.max(last.high,livePrice),low:Math.min(last.low,livePrice),close:livePrice};
      }
      window.__fomoLiveLastCandle=last;
      try{candleSeries.update(last)}catch(err){
        console.warn("Live candle update rejected; rebuilding current candle",err);
        window.__fomoLiveLastCandle={time:currentBucket,open:livePrice,high:livePrice,low:livePrice,close:livePrice};
        candleSeries.update(window.__fomoLiveLastCandle);
      }
      const freshChange=Number(pair.priceChange?.h24);
      const freshVolume=Number(pair.volume?.h24);
      const freshLiquidity=Number(pair.liquidity?.usd);
      const next={...x,priceUsd:livePrice,change24h:Number.isFinite(freshChange)?freshChange:x.change24h,volume24h:Number.isFinite(freshVolume)?freshVolume:x.volume24h,liquidityUsd:Number.isFinite(freshLiquidity)?freshLiquidity:x.liquidityUsd};
      updateMeta(next,livePrice);updateFacts(next,livePrice);
      const idx=data.findIndex(z=>z.chain===x.chain&&z.address.toLowerCase()===x.address.toLowerCase());
      if(idx>=0){data[idx]=next;selected=data[idx]}
    }catch(e){console.warn("Live chart update failed",e)}
  };
  const originalLoadCandles=window.loadCandles;
  window.loadCandles=async function(x){
    stop();window.__fomoLiveLastCandle=null;
    if(originalLoadCandles)await originalLoadCandles(x);
    if(selected&&selected.address===x.address&&selected.chain===x.chain&&candleSeries){
      const myGeneration=generation;
      await poll(x,myGeneration);
      timer=setInterval(()=>poll(selected,myGeneration),POLL_MS);
    }
  };
  document.addEventListener("click",e=>{
    if(e.target&&e.target.id==="closeChart")setTimeout(stop,0);
    if(e.target&&e.target.matches("[data-tf]"))setTimeout(()=>{if(selected){stop();window.__fomoLiveLastCandle=null;const myGeneration=generation;timer=setInterval(()=>poll(selected,myGeneration),POLL_MS)}},100);
  });
  window.addEventListener("beforeunload",stop);
})();