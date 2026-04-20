import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  ColorType,
  CrosshairMode,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type CandlestickData,
  type LineData,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import { API_BASE } from "../api/client";

interface CandlePoint { time: string; open: number; high: number; low: number; close: number; }
interface CandleMarker { time: string; direction: string; action: string; }
interface IndicatorPoint { time: string; value: number; }

interface CandlesApiResponse {
  candles: CandlePoint[];
  markers: CandleMarker[];
  strategy_type: string;
  indicators: {
    sma_short?: IndicatorPoint[];
    sma_long?: IndicatorPoint[];
    rsi?: IndicatorPoint[];
    oversold?: number;
    overbought?: number;
    macd?: IndicatorPoint[];
    macd_signal?: IndicatorPoint[];
    bb_upper?: IndicatorPoint[];
    bb_mid?: IndicatorPoint[];
    bb_lower?: IndicatorPoint[];
  };
}

interface Props {
  strategyId: string;
  strategyName: string;
  initialInterval?: string;
  focusDate?: string;
}

const INTERVALS = [
  { label: "日足", value: "1d", period: "1y" },
  { label: "1時間足", value: "1h", period: "3mo" },
  { label: "30分足", value: "30m", period: "60d" },
];

export function CandlestickChart({ strategyId, strategyName, focusDate }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const rsiContainerRef = useRef<HTMLDivElement>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);
  const macdContainerRef = useRef<HTMLDivElement>(null);
  const macdChartRef = useRef<IChartApi | null>(null);
  const [interval, setIntervalVal] = useState("1d");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMarkers, setShowMarkers] = useState(true);
  const [strategyType, setStrategyType] = useState("sma_crossover");
  const [candlesData, setCandlesData] = useState<CandlesApiResponse | null>(null);
  const markersRef = useRef<SeriesMarker<Time>[]>([]);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const candleDatesRef = useRef<string[]>([]);

  // チャート初期化（interval変化時に再作成）
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: "#ffffff" }, textColor: "#374151" },
      grid: { vertLines: { color: "#f3f4f6" }, horzLines: { color: "#f3f4f6" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#e5e7eb" },
      timeScale: { borderColor: "#e5e7eb", timeVisible: true },
      width: containerRef.current.clientWidth,
      height: 400,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981", downColor: "#ef4444",
      borderUpColor: "#10b981", borderDownColor: "#ef4444",
      wickUpColor: "#10b981", wickDownColor: "#ef4444",
    });
    chartRef.current = chart;
    seriesRef.current = series;
    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(containerRef.current);
    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersPluginRef.current = null;
    };
  }, [interval]);

  // データ取得
  useEffect(() => {
    if (!seriesRef.current) return;
    const cfg = INTERVALS.find((i) => i.value === interval) ?? INTERVALS[0];
    setLoading(true);
    setError(null);

    fetch(`${API_BASE}/api/strategies/${strategyId}/candles?interval=${interval}&period=${cfg.period}`)
      .then((r) => { if (!r.ok) throw new Error("データ取得失敗"); return r.json(); })
      .then((data: CandlesApiResponse) => {
        if (!seriesRef.current || !chartRef.current) return;

        const toTime = (s: string): Time => {
          if (!s.includes(" ")) return s as Time;
          const [date, time] = s.split(" ");
          return (new Date(`${date}T${time}:00Z`).getTime() / 1000) as unknown as Time;
        };
        const toLineData = (pts: IndicatorPoint[]): LineData[] =>
          pts.map((p) => ({ time: toTime(p.time), value: p.value }));

        const candles: CandlestickData[] = data.candles.map((c) => ({
          time: toTime(c.time), open: c.open, high: c.high, low: c.low, close: c.close,
        }));
        candleDatesRef.current = data.candles.map((c) => c.time.split(" ")[0]);
        seriesRef.current.setData(candles);

        // SMA overlay
        if (data.strategy_type === "sma_crossover" && data.indicators.sma_short && data.indicators.sma_long) {
          const smaS = chartRef.current.addSeries(LineSeries, { color: "#6366f1", lineWidth: 1, priceLineVisible: false });
          smaS.setData(toLineData(data.indicators.sma_short));
          const smaL = chartRef.current.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 1, priceLineVisible: false });
          smaL.setData(toLineData(data.indicators.sma_long));
        }

        // Bollinger Bands overlay
        if (data.strategy_type === "bollinger" && data.indicators.bb_upper && data.indicators.bb_mid && data.indicators.bb_lower) {
          const bbU = chartRef.current.addSeries(LineSeries, { color: "#3b82f6", lineWidth: 1, priceLineVisible: false });
          bbU.setData(toLineData(data.indicators.bb_upper));
          const bbM = chartRef.current.addSeries(LineSeries, { color: "#9ca3af", lineWidth: 1, priceLineVisible: false });
          bbM.setData(toLineData(data.indicators.bb_mid));
          const bbL = chartRef.current.addSeries(LineSeries, { color: "#3b82f6", lineWidth: 1, priceLineVisible: false });
          bbL.setData(toLineData(data.indicators.bb_lower));
        }

        const markers: SeriesMarker<Time>[] = data.markers.map((m) => {
          const isEntry = m.action === "entry";
          const isLong = m.direction === "long";
          return {
            time: toTime(m.time),
            position: isEntry ? (isLong ? "belowBar" : "aboveBar") : (isLong ? "aboveBar" : "belowBar"),
            color: isEntry ? (isLong ? "#10b981" : "#ef4444") : "#f59e0b",
            shape: isEntry ? (isLong ? "arrowUp" : "arrowDown") : ("square" as const),
            text: isEntry ? (isLong ? "買" : "売") : "決",
          };
        });
        markersRef.current = markers;
        if (markersPluginRef.current) {
          markersPluginRef.current.setMarkers(showMarkers ? markers : []);
        } else {
          markersPluginRef.current = createSeriesMarkers(seriesRef.current, showMarkers ? markers : []);
        }
        chartRef.current.timeScale().fitContent();

        if (interval !== "1d" && candles.length > 100) {
          chartRef.current.timeScale().setVisibleLogicalRange({
            from: candles.length - 100, to: candles.length - 1,
          });
        }

        // Trigger subchart population via separate effect (runs AFTER SubPanel mounts)
        setStrategyType(data.strategy_type);
        setCandlesData(data);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [strategyId, interval]);

  // Populate RSI / MACD subcharts AFTER SubPanel mounts (strategyType change → re-render → SubPanel's effect sets ref → this effect runs)
  useEffect(() => {
    if (!candlesData || !chartRef.current) return;

    const toTime = (s: string): Time => {
      if (!s.includes(" ")) return s as Time;
      const [date, time] = s.split(" ");
      return (new Date(`${date}T${time}:00Z`).getTime() / 1000) as unknown as Time;
    };
    const toLineData = (pts: IndicatorPoint[]): LineData[] =>
      pts.map((p) => ({ time: toTime(p.time), value: p.value }));

    let subChart: IChartApi | null = null;

    if (strategyType === "rsi" && candlesData.indicators.rsi && rsiChartRef.current) {
      const rsiSeries = rsiChartRef.current.addSeries(LineSeries, { color: "#8b5cf6", lineWidth: 2, priceLineVisible: false });
      rsiSeries.setData(toLineData(candlesData.indicators.rsi));
      rsiChartRef.current.timeScale().fitContent();
      subChart = rsiChartRef.current;
    }

    if (strategyType === "macd" && candlesData.indicators.macd && candlesData.indicators.macd_signal && macdChartRef.current) {
      const macdLine = macdChartRef.current.addSeries(LineSeries, { color: "#6366f1", lineWidth: 2, priceLineVisible: false });
      macdLine.setData(toLineData(candlesData.indicators.macd));
      const signalLine = macdChartRef.current.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 1, priceLineVisible: false });
      signalLine.setData(toLineData(candlesData.indicators.macd_signal));
      macdChartRef.current.timeScale().fitContent();
      subChart = macdChartRef.current;
    }

    // 時間軸同期
    if (subChart) {
      const main = chartRef.current.timeScale();
      const subTs = subChart.timeScale();
      let syncing = false;
      main.subscribeVisibleLogicalRangeChange((range) => {
        if (syncing || !range) return;
        syncing = true; subTs.setVisibleLogicalRange(range); syncing = false;
      });
      subTs.subscribeVisibleLogicalRangeChange((range) => {
        if (syncing || !range) return;
        syncing = true; main.setVisibleLogicalRange(range); syncing = false;
      });
    }
  }, [candlesData, strategyType, interval]);

  // focusDateジャンプ
  useEffect(() => {
    if (!focusDate || !chartRef.current) return;
    const targetDate = focusDate.split(" ")[0];
    const idx = candleDatesRef.current.findIndex((d) => d === targetDate);
    if (idx === -1) return;
    const from = Math.max(0, idx - 20);
    const to = Math.min(candleDatesRef.current.length - 1, idx + 40);
    chartRef.current.timeScale().setVisibleLogicalRange({ from, to });
    if (rsiChartRef.current) rsiChartRef.current.timeScale().setVisibleLogicalRange({ from, to });
    if (macdChartRef.current) macdChartRef.current.timeScale().setVisibleLogicalRange({ from, to });
  }, [focusDate]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{strategyName}</span>
        <div style={{ display: "flex", gap: 4 }}>
          {INTERVALS.map((i) => (
            <button key={i.value} type="button" onClick={() => setIntervalVal(i.value)}
              style={{
                padding: "4px 12px", borderRadius: 6, border: "1px solid #e5e7eb",
                background: interval === i.value ? "#6366f1" : "#fff",
                color: interval === i.value ? "#fff" : "#374151",
                cursor: "pointer", fontSize: 13,
                fontWeight: interval === i.value ? 600 : 400,
              }}
            >{i.label}</button>
          ))}
        </div>
        <button type="button"
          onClick={() => {
            const next = !showMarkers;
            setShowMarkers(next);
            if (markersPluginRef.current) markersPluginRef.current.setMarkers(next ? markersRef.current : []);
          }}
          style={{
            padding: "4px 12px", borderRadius: 6, border: "1px solid #e5e7eb",
            background: showMarkers ? "#fef3c7" : "#fff", color: "#374151", cursor: "pointer", fontSize: 13,
          }}
        >{showMarkers ? "マーカー非表示" : "マーカー表示"}</button>
        {loading && <span style={{ fontSize: 12, color: "#9ca3af" }}>読み込み中...</span>}
      </div>
      {error && <p style={{ color: "#ef4444", fontSize: 13 }}>{error}</p>}
      <div ref={containerRef} style={{ width: "100%", borderRadius: 8, overflow: "hidden", border: "1px solid #e5e7eb" }} />
      {strategyType === "rsi" && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>RSI</div>
          <SubPanel key={`rsi-${interval}`} containerRef={rsiContainerRef} chartRef={rsiChartRef} bgColor="#faf5ff" />
        </div>
      )}
      {strategyType === "macd" && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>MACD <span style={{ color: "#6366f1" }}>─</span> Signal <span style={{ color: "#f59e0b" }}>─</span></div>
          <SubPanel key={`macd-${interval}`} containerRef={macdContainerRef} chartRef={macdChartRef} bgColor="#f0f9ff" />
        </div>
      )}
    </div>
  );
}

function SubPanel({ containerRef, chartRef, bgColor }: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  chartRef: React.MutableRefObject<IChartApi | null>;
  bgColor: string;
}) {
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: bgColor }, textColor: "#374151" },
      grid: { vertLines: { color: "#f3f4f6" }, horzLines: { color: "#e5e7eb" } },
      rightPriceScale: { borderColor: "#e5e7eb", scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderColor: "#e5e7eb", timeVisible: true },
      crosshair: { mode: CrosshairMode.Normal },
      width: containerRef.current.clientWidth,
      height: 150,
    });
    chartRef.current = chart;
    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(containerRef.current);
    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, []);

  return <div ref={containerRef as React.RefObject<HTMLDivElement>} style={{ width: "100%", border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }} />;
}
