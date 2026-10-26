/* Capture the chart instance created by app.js so live-chart.js can update it. */
(function () {
  const LC = window.LightweightCharts;
  if (!LC || typeof LC.createChart !== "function") return;
  const originalCreateChart = LC.createChart;
  LC.createChart = function (...args) {
    const chart = originalCreateChart.apply(this, args);
    window.__FOMO_CHART__ = chart;
    if (chart && typeof chart.addCandlestickSeries === "function" && !chart.__fomoWrapped) {
      const originalAdd = chart.addCandlestickSeries.bind(chart);
      chart.addCandlestickSeries = function (...seriesArgs) {
        const series = originalAdd(...seriesArgs);
        window.__FOMO_CANDLE__ = series;
        return series;
      };
      chart.__fomoWrapped = true;
    }
    return chart;
  };
})();
