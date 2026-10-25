/* FOMOAI live chart updater. Keeps the selected candle chart synced with current market price. */
(function(){
  const POLL_MS=5000;
  let timer=null;
  let generation=0;
  const liveJson=async url=>{const r=await fetch(url,{headers:{Accept:"application/json"},cache:"no-store"});if(!r.ok)throw Error("Live market returned "+r.status);return r.json()};
  const stop=()=>{generation++;if(timer){clearInterval(timer);timer=null}};
  const updateMeta=(x,p)=>{
    const el=document.querySelector("#chartMeta");
    if(el&&x)el.textContent="LIVE • "+x.chain+" · "+price(p)+" · "+(Number(x.change24h)>=0?"+":"")+Number(x.change24h||0).toFixed(2)+"% in 24h · updated "+new Date().toLocaleTimeString();
  };
  const updateFacts=(x,p)=>{
    const f=document.querySelector("#chartFacts");
    if(!f||!x||typeof setupFor!=="function")return;
    const s=setupFor({...x,priceUsd:p});
    f.innerHTML=[["Live price",price(p)],["24h volume",money(x.volume24h)],["Liquidity",money(x.liquidityUsd)],["Buy pressure",x.buyPressure+"%"],["Entry zone",price(s.entryLow)+" – "+price(s.entryHigh)],["Stop loss reference",price(s.stop)],["Take profit 1",price(s.tp1)],["Take profit 2 / 3",price(s.tp2)+" / "+price(s.tp3)]].map(([k,v])=>'<div class="fact"><small>'+k+'</small><b>'+v+'</b></div>').join("");
  };
  const poll=async(x,tokenGeneration)=>{
    if(!x||!candleSeries||tokenGeneration!==generation)return;
    try{
      const network=NETWORKS[String(x.chain||"").toLowerCase()];
      if(!network||!x.pairAddress)return;
      const pairUrl=DEX+"/latest/dex/pairs/"+encodeURIComponent(x.chain)+"/"+encodeURIComponent(x.pairAddress);
      const payload=await liveJson(pairUrl);
      const pair=payload?.pairs?.[0];
      const livePrice=Number(pair?.priceUsd||0);
      if(!livePrice)return;
      const now=Math.floor(Date.now()/1000);
      const bucket=activeTf==="hour"?(Number(activeAgg)||1)*3600:(Number(activeAgg)||5)*60;
      const lastSeries=typeof candleSeries.dataByIndex==="function"?null:null;
      let last=null;
      try{last=window.__fomoLiveLastCandle||null}catch{}
      if(!last){
        const chartData=await liveJson("https://api.geckoterminal.com/api/v2/networks/"+encodeURIComponent(network)+"/pools/"+encodeURIComponent(x.pairAddress)+"/ohlcv/"+activeTf+"?aggregate="+encodeURIComponent(activeAgg)+"&limit=2&currency=usd");
        const rows=chartData?.data?.attributes?.ohlcv_list||[];
        const r=rows[rows.length-1];
        if(r)last={time:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4])};
      }
      if(!last){last={time:Math.floor(now/bucket)*bucket,open:livePrice,high:livePrice,low:livePrice,close:livePrice}}
      const currentBucket=Math.floor(now/bucket)*bucket;
      if(last.time===currentBucket){
        last={time:last.time,open:last.open,high:Math.max(last.high,livePrice),low:Math.min(last.low,livePrice),close:livePrice};
      }else if(currentBucket>last.time){
        last={time:currentBucket,open:last.close,high:Math.max(last.close,livePrice),low:Math.min(last.close,livePrice),close:livePrice};
      }else{
        last={time:last.time,open:last.open,high:Math.max(last.high,livePrice),low:Math.min(last.low,livePrice),close:livePrice};
      }
      window.__fomoLiveLastCandle=last;
      candleSeries.update(last);
      updateMeta(x,livePrice);
      updateFacts(x,livePrice);
      const idx=data.findIndex(z=>z.chain===x.chain&&z.address.toLowerCase()===x.address.toLowerCase());
      if(idx>=0){data[idx]={...data[idx],priceUsd:livePrice,change24h:Number(pair.priceChange?.h24??data[idx].change24h),volume24h:Number(pair.volume?.h24??data[idx].volume24h),liquidityUsd:Number(pair.liquidity?.usd??data[idx].liquidityUsd)};selected=data[idx];}
    }catch(e){console.warn("Live chart update failed",e)}
  };
  const originalShowChart=window.showChart;
  window.showChart=async function(x){
    stop();
    window.__fomoLiveLastCandle=null;
    if(originalShowChart)await originalShowChart(x);
    const myGeneration=generation;
    if(!selected||selected.address!==x.address||selected.chain!==x.chain||!candleSeries)return;
    await poll(x,myGeneration);
    timer=setInterval(()=>poll(selected,myGeneration),POLL_MS);
  };
  const originalLoadCandles=window.loadCandles;
  window.loadCandles=async function(x){
    stop();
    window.__fomoLiveLastCandle=null;
    if(originalLoadCandles)await originalLoadCandles(x);
    if(selected&&selected.address===x.address&&selected.chain===x.chain&&candleSeries){
      const myGeneration=generation;
      await poll(x,myGeneration);
      timer=setInterval(()=>poll(selected,myGeneration),POLL_MS);
    }
  };
  document.addEventListener("click",e=>{
    if(e.target&&e.target.id==="closeChart")setTimeout(stop,0);
    if(e.target&&e.target.matches("[data-tf]"))setTimeout(()=>{if(selected){stop();window.__fomoLiveLastCandle=null;const myGeneration=generation;timer=setInterval(()=>poll(selected,myGeneration),POLL_MS)}},50);
  });
  window.addEventListener("beforeunload",stop);
})();
