import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useCompareShare } from "../hooks/useCompareShare";
import {
  StrategyCompareEquityChart,
  StrategyCompareDrawdownChart,
} from "../components/StrategyCompareOverlayChart";
import { CandlestickChart } from "../components/CandlestickChart";

const COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#3b82f6"];

const SYMBOLS = [
  { label: "USD/JPY", value: "USDJPY=X" },
  { label: "EUR/USD", value: "EURUSD=X" },
  { label: "GBP/JPY", value: "GBPJPY=X" },
  { label: "EUR/JPY", value: "EURJPY=X" },
  { label: "AUD/USD", value: "AUDUSD=X" },
  { label: "GBP/USD", value: "GBPUSD=X" },
];

const PERIODS = [
  { label: "6ヶ月", value: "6mo" },
  { label: "1年", value: "1y" },
  { label: "2年", value: "2y" },
  { label: "5年", value: "5y" },
];

interface Strategy {
  id: string;
  name: string;
  params: Record<string, string | number>;
}

interface TradePoint {
  t: number;
  date?: string;
  equity: number;
  drawdown: number;
  session?: string;
}

interface TradeRecord {
  trade_id: number;
  direction: string;
  entry_date: string;
  exit_date: string;
  entry_price: number;
  exit_price: number;
  pnl_pips: number;
  session?: string;
}

interface BacktestResult {
  strategy_id: string;
  trades: TradePoint[];
  trade_list: TradeRecord[];
}

interface MergedPoint {
  t: number;
  date?: string;
  [key: string]: number | string | undefined;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  fontSize: 14,
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  color: "#374151",
  marginBottom: 4,
};

export function StrategyComparePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const idsParam = searchParams.get("ids") ?? "";
  const selectedIds = idsParam ? idsParam.split(",").filter(Boolean) : [];

  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set(selectedIds));
  const dragIndex = useRef<number | null>(null);
  const [equityData, setEquityData] = useState<MergedPoint[]>([]);
  const [drawdownData, setDrawdownData] = useState<MergedPoint[]>([]);
  const [chartStrategies, setChartStrategies] = useState<Strategy[]>([]);
  const [allTradeLists, setAllTradeLists] = useState<{ strategy: Strategy; trades: TradeRecord[] }[]>([]);
  const [highlight, setHighlight] = useState<{ date: string; color: string } | null>(null);
  const [candleFocus, setCandleFocus] = useState<{ strategyId: string; date: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // フォーム
  const [form, setForm] = useState({
    name: "",
    strategy_type: "sma_crossover",
    symbol: "USDJPY=X",
    interval: "1d",
    trade_direction: "both",
    sma_short: 5,
    sma_long: 20,
    rsi_period: 14,
    oversold: 30,
    overbought: 70,
    macd_fast: 12,
    macd_slow: 26,
    macd_signal: 9,
    bb_period: 20,
    bb_std: 2.0,
    period: "1y",
    sl_pips: 0,
    tp_pips: 0,
  });
  const [creating, setCreating] = useState(false);

  const { share } = useCompareShare(selectedIds);

  const fetchStrategies = () => {
    fetch("/api/strategies")
      .then((r) => r.json())
      .then(setStrategies)
      .catch(() => {});
  };

  useEffect(() => {
    fetchStrategies();
  }, []);

  // URLのidsが変わったらチャートを更新
  useEffect(() => {
    if (selectedIds.length === 0) {
      setEquityData([]);
      setDrawdownData([]);
      setChartStrategies([]);
      return;
    }
    setLoading(true);
    setError(null);

    Promise.all(
      selectedIds.map((id) =>
        Promise.all([
          fetch(`/api/strategies/${id}`).then((r) => {
            if (!r.ok) throw new Error(`Strategy ${id} not found`);
            return r.json() as Promise<Strategy>;
          }),
          fetch(`/api/strategies/${id}/backtest`).then((r) => {
            if (!r.ok) throw new Error(`Backtest failed for ${id}`);
            return r.json() as Promise<BacktestResult>;
          }),
        ])
      )
    )
      .then((results) => {
        const strats = results.map(([s]) => s as Strategy);
        const allBacktests = results.map(([, b]) => b as BacktestResult);
        const allTrades = allBacktests.map((b) => b.trades);

        setChartStrategies(strats);
        setAllTradeLists(strats.map((s, i) => ({ strategy: s, trades: allBacktests[i].trade_list ?? [] })));

        const len = allTrades[0]?.length ?? 0;
        const equity: MergedPoint[] = [];
        const dd: MergedPoint[] = [];

        for (let i = 0; i < len; i++) {
          const date = allTrades[0][i]?.date;
          const ePoint: MergedPoint = { t: i, date };
          const dPoint: MergedPoint = { t: i, date };
          strats.forEach((s, si) => {
            ePoint[s.name] = allTrades[si][i]?.equity ?? 0;
            dPoint[`${s.name}_dd`] = allTrades[si][i]?.drawdown ?? 0;
          });
          equity.push(ePoint);
          dd.push(dPoint);
        }

        setEquityData(equity);
        setDrawdownData(dd);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [idsParam]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (form.sma_short >= form.sma_long) {
      alert("SMA短期は長期より小さくしてください");
      return;
    }
    setCreating(true);
    try {
      const params: Record<string, string | number> = {
        strategy_type: form.strategy_type,
        symbol: form.symbol,
        interval: form.interval,
        trade_direction: form.trade_direction,
        period: form.period,
        sl_pips: form.sl_pips,
        tp_pips: form.tp_pips,
      };
      if (form.strategy_type === "sma_crossover") {
        params.sma_short = form.sma_short;
        params.sma_long = form.sma_long;
      } else if (form.strategy_type === "rsi") {
        params.rsi_period = form.rsi_period;
        params.oversold = form.oversold;
        params.overbought = form.overbought;
      } else if (form.strategy_type === "macd") {
        params.macd_fast = form.macd_fast;
        params.macd_slow = form.macd_slow;
        params.macd_signal = form.macd_signal;
      } else if (form.strategy_type === "bollinger") {
        params.bb_period = form.bb_period;
        params.bb_std = form.bb_std;
      }
      const res = await fetch("/api/strategies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name, params }),
      });
      if (!res.ok) throw new Error("作成失敗");
      await fetchStrategies();
      setForm((f) => ({ ...f, name: "" }));
    } catch {
      alert("戦略の作成に失敗しました");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("この戦略を削除しますか？")) return;
    await fetch(`/api/strategies/${id}`, { method: "DELETE" });
    setCheckedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    fetchStrategies();
  };

  const toggleCheck = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDragStart = (index: number) => {
    dragIndex.current = index;
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex.current === null || dragIndex.current === index) return;
    setStrategies((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex.current!, 1);
      next.splice(index, 0, moved);
      dragIndex.current = index;
      return next;
    });
  };

  const handleDragEnd = () => {
    dragIndex.current = null;
  };

  const handleCompare = () => {
    if (checkedIds.size === 0) return;
    navigate(`/compare?ids=${Array.from(checkedIds).join(",")}`);
  };

  const items = chartStrategies.map((s, i) => ({
    id: s.id,
    name: s.name,
    color: COLORS[i % COLORS.length],
  }));

  return (
    <div style={{ fontFamily: "sans-serif", maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 24, marginBottom: 24 }}>FX戦略比較</h1>

      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 24, marginBottom: 32 }}>
        {/* 戦略作成フォーム */}
        <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: 20 }}>
          <h2 style={{ fontSize: 16, marginBottom: 16, marginTop: 0 }}>戦略を作成</h2>
          <form onSubmit={handleCreate}>
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>戦略名</label>
              <input
                style={inputStyle}
                placeholder="例: SMA5/20 USD/JPY"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>戦略タイプ</label>
              <select
                style={inputStyle}
                value={form.strategy_type}
                onChange={(e) => setForm((f) => ({ ...f, strategy_type: e.target.value }))}
              >
                <option value="sma_crossover">SMAクロスオーバー</option>
                <option value="rsi">RSI逆張り</option>
                <option value="macd">MACDクロス</option>
                <option value="bollinger">ボリンジャーバンド</option>
              </select>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>通貨ペア</label>
              <select
                style={inputStyle}
                value={form.symbol}
                onChange={(e) => setForm((f) => ({ ...f, symbol: e.target.value }))}
              >
                {SYMBOLS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>時間足</label>
              <select
                style={inputStyle}
                value={form.interval}
                onChange={(e) => setForm((f) => ({ ...f, interval: e.target.value }))}
              >
                <option value="1d">日足</option>
                <option value="1h">1時間足</option>
                <option value="30m">30分足</option>
              </select>
            </div>

            {form.strategy_type === "sma_crossover" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>SMA 短期</label>
                  <input style={inputStyle} type="number" min={2} max={200} value={form.sma_short}
                    onChange={(e) => setForm((f) => ({ ...f, sma_short: Number(e.target.value) }))} />
                </div>
                <div>
                  <label style={labelStyle}>SMA 長期</label>
                  <input style={inputStyle} type="number" min={3} max={500} value={form.sma_long}
                    onChange={(e) => setForm((f) => ({ ...f, sma_long: Number(e.target.value) }))} />
                </div>
              </div>
            )}
            {form.strategy_type === "rsi" && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ marginBottom: 10 }}>
                  <label style={labelStyle}>RSI期間</label>
                  <input style={inputStyle} type="number" min={2} max={100} value={form.rsi_period}
                    onChange={(e) => setForm((f) => ({ ...f, rsi_period: Number(e.target.value) }))} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label style={labelStyle}>売られすぎ（買い）</label>
                    <input style={inputStyle} type="number" min={1} max={49} value={form.oversold}
                      onChange={(e) => setForm((f) => ({ ...f, oversold: Number(e.target.value) }))} />
                  </div>
                  <div>
                    <label style={labelStyle}>買われすぎ（売り）</label>
                    <input style={inputStyle} type="number" min={51} max={99} value={form.overbought}
                      onChange={(e) => setForm((f) => ({ ...f, overbought: Number(e.target.value) }))} />
                  </div>
                </div>
              </div>
            )}
            {form.strategy_type === "macd" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>Fast</label>
                  <input style={inputStyle} type="number" min={2} max={100} value={form.macd_fast}
                    onChange={(e) => setForm((f) => ({ ...f, macd_fast: Number(e.target.value) }))} />
                </div>
                <div>
                  <label style={labelStyle}>Slow</label>
                  <input style={inputStyle} type="number" min={3} max={200} value={form.macd_slow}
                    onChange={(e) => setForm((f) => ({ ...f, macd_slow: Number(e.target.value) }))} />
                </div>
                <div>
                  <label style={labelStyle}>Signal</label>
                  <input style={inputStyle} type="number" min={2} max={50} value={form.macd_signal}
                    onChange={(e) => setForm((f) => ({ ...f, macd_signal: Number(e.target.value) }))} />
                </div>
              </div>
            )}
            {form.strategy_type === "bollinger" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>期間</label>
                  <input style={inputStyle} type="number" min={5} max={200} value={form.bb_period}
                    onChange={(e) => setForm((f) => ({ ...f, bb_period: Number(e.target.value) }))} />
                </div>
                <div>
                  <label style={labelStyle}>標準偏差</label>
                  <input style={inputStyle} type="number" min={0.5} max={5} step={0.5} value={form.bb_std}
                    onChange={(e) => setForm((f) => ({ ...f, bb_std: Number(e.target.value) }))} />
                </div>
              </div>
            )}

            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>取引方向</label>
              <select style={inputStyle} value={form.trade_direction}
                onChange={(e) => setForm((f) => ({ ...f, trade_direction: e.target.value }))}>
                <option value="both">両方（ロング/ショート）</option>
                <option value="long_only">ロングのみ</option>
                <option value="short_only">ショートのみ</option>
              </select>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>SL (pips) <span style={{ fontWeight: 400, color: "#9ca3af" }}>0=なし</span></label>
                <input style={inputStyle} type="number" min={0} value={form.sl_pips}
                  onChange={(e) => setForm((f) => ({ ...f, sl_pips: Number(e.target.value) }))} />
              </div>
              <div>
                <label style={labelStyle}>TP (pips) <span style={{ fontWeight: 400, color: "#9ca3af" }}>0=なし</span></label>
                <input style={inputStyle} type="number" min={0} value={form.tp_pips}
                  onChange={(e) => setForm((f) => ({ ...f, tp_pips: Number(e.target.value) }))} />
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>バックテスト期間</label>
              <select
                style={inputStyle}
                value={form.period}
                onChange={(e) => setForm((f) => ({ ...f, period: e.target.value }))}
              >
                {PERIODS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              disabled={creating}
              style={{
                width: "100%",
                padding: "10px",
                background: creating ? "#9ca3af" : "#6366f1",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                fontWeight: 600,
                fontSize: 14,
                cursor: creating ? "not-allowed" : "pointer",
              }}
            >
              {creating ? "作成中..." : "戦略を作成"}
            </button>
          </form>
        </div>

        {/* 戦略リスト */}
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, margin: 0 }}>作成済み戦略（{strategies.length}件）</h2>
            <button
              type="button"
              onClick={handleCompare}
              disabled={checkedIds.size === 0}
              style={{
                padding: "8px 20px",
                background: checkedIds.size === 0 ? "#9ca3af" : "#10b981",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                fontWeight: 600,
                fontSize: 14,
                cursor: checkedIds.size === 0 ? "not-allowed" : "pointer",
              }}
            >
              選択した戦略を比較 ({checkedIds.size})
            </button>
          </div>

          {strategies.length === 0 ? (
            <p style={{ color: "#9ca3af", textAlign: "center", padding: 24 }}>
              まだ戦略がありません。左のフォームで作成してください。
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {strategies.map((s, i) => (
                <div
                  key={s.id}
                  draggable
                  onDragStart={() => handleDragStart(i)}
                  onDragOver={(e) => handleDragOver(e, i)}
                  onDragEnd={handleDragEnd}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 14px",
                    border: `2px solid ${checkedIds.has(s.id) ? "#6366f1" : "#e5e7eb"}`,
                    borderRadius: 8,
                    cursor: "grab",
                    background: checkedIds.has(s.id) ? "#eef2ff" : "#fff",
                    userSelect: "none",
                  }}
                >
                  <span style={{ color: "#9ca3af", fontSize: 16 }}>⠿</span>
                  <input
                    type="checkbox"
                    checked={checkedIds.has(s.id)}
                    onChange={() => toggleCheck(s.id)}
                    style={{ width: 16, height: 16, cursor: "pointer" }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{s.name}</div>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>
                      {s.params.symbol} |{" "}
                      {s.params.strategy_type === "rsi"
                        ? `RSI(${s.params.rsi_period}) ${s.params.oversold}/${s.params.overbought}`
                        : s.params.strategy_type === "macd"
                        ? `MACD(${s.params.macd_fast},${s.params.macd_slow},${s.params.macd_signal})`
                        : s.params.strategy_type === "bollinger"
                        ? `BB(${s.params.bb_period},${s.params.bb_std}σ)`
                        : `SMA ${s.params.sma_short}/${s.params.sma_long}`
                      } | {s.params.interval ?? "1d"} | {s.params.period}
                      {s.params.trade_direction && s.params.trade_direction !== "both"
                        ? ` | ${s.params.trade_direction === "long_only" ? "ロングのみ" : "ショートのみ"}`
                        : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}
                    style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 16, padding: "0 4px" }}
                    title="削除"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* チャートエリア */}
      {selectedIds.length > 0 && (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <span style={{ fontSize: 14, color: "#555" }}>
              比較中: {chartStrategies.map((s) => s.name).join(", ")}
            </span>
            <button
              onClick={share}
              style={{
                padding: "8px 18px",
                background: "#6366f1",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              共有URLをコピー
            </button>
          </div>

          {loading && <p style={{ textAlign: "center", color: "#888" }}>バックテスト実行中（初回は数秒かかります）...</p>}
          {error && <p style={{ color: "red" }}>エラー: {error}</p>}

          {!loading && !error && equityData.length > 0 && (
            <>
              <h3 style={{ fontSize: 16, marginBottom: 8 }}>エクイティ曲線（重ね表示）</h3>
              <StrategyCompareEquityChart data={equityData} items={items} highlight={highlight} />
              <h3 style={{ fontSize: 16, marginTop: 32, marginBottom: 8 }}>ドローダウン比較</h3>
              <StrategyCompareDrawdownChart data={drawdownData} items={items} />

              {/* 戦略ごとに トレードリスト → ローソク足 */}
              {allTradeLists.map(({ strategy, trades }, si) => (
                <div key={strategy.id} style={{ marginTop: 48, borderTop: "2px solid #e5e7eb", paddingTop: 32 }}>
                  <h2 style={{ fontSize: 18, marginBottom: 20, color: COLORS[si % COLORS.length] }}>
                    {strategy.name}
                  </h2>

                  {/* 統計サマリー */}
                  {(() => {
                    const wins = trades.filter(t => t.pnl_pips > 0);
                    const losses = trades.filter(t => t.pnl_pips <= 0);
                    const winRate = trades.length ? (wins.length / trades.length * 100).toFixed(1) : "0";
                    const avgWin = wins.length ? (wins.reduce((s, t) => s + t.pnl_pips, 0) / wins.length).toFixed(1) : "0";
                    const avgLoss = losses.length ? (losses.reduce((s, t) => s + t.pnl_pips, 0) / losses.length).toFixed(1) : "0";
                    const grossWin = wins.reduce((s, t) => s + t.pnl_pips, 0);
                    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl_pips, 0));
                    const pf = grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : "∞";
                    let eq = 0, peak = 0, maxDD = 0;
                    for (const t of trades) { eq += t.pnl_pips; peak = Math.max(peak, eq); maxDD = Math.min(maxDD, eq - peak); }

                    const sessions = ["tokyo", "london", "ny"] as const;
                    const sessionLabel: Record<string, string> = { tokyo: "東京", london: "ロンドン", ny: "NY" };
                    const hasSessions = trades.some(t => t.session);

                    return (
                      <div style={{ marginBottom: 24 }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: hasSessions ? 12 : 0 }}>
                          {[
                            { label: "勝率", value: `${winRate}%`, color: Number(winRate) >= 50 ? "#10b981" : "#ef4444" },
                            { label: "平均利益", value: `+${avgWin} pips`, color: "#10b981" },
                            { label: "平均損失", value: `${avgLoss} pips`, color: "#ef4444" },
                            { label: "PF", value: pf, color: Number(pf) >= 1 ? "#10b981" : "#ef4444" },
                            { label: "最大DD", value: `${maxDD.toFixed(1)} pips`, color: "#ef4444" },
                          ].map(({ label, value, color }) => (
                            <div key={label} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 14px", minWidth: 90 }}>
                              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 2 }}>{label}</div>
                              <div style={{ fontSize: 15, fontWeight: 700, color }}>{value}</div>
                            </div>
                          ))}
                        </div>

                        {hasSessions && (
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            {sessions.map(sess => {
                              const st = trades.filter(t => t.session === sess);
                              if (!st.length) return null;
                              const sw = st.filter(t => t.pnl_pips > 0).length;
                              const sTotal = Math.round(st.reduce((s, t) => s + t.pnl_pips, 0) * 10) / 10;
                              return (
                                <div key={sess} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "6px 12px", fontSize: 12 }}>
                                  <span style={{ fontWeight: 600, marginRight: 6 }}>{sessionLabel[sess]}</span>
                                  {st.length}件 勝率{(sw / st.length * 100).toFixed(0)}%
                                  <span style={{ marginLeft: 6, fontWeight: 700, color: sTotal >= 0 ? "#10b981" : "#ef4444" }}>
                                    {sTotal >= 0 ? "+" : ""}{sTotal} pips
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* トレードリスト */}
                  <h3 style={{ fontSize: 15, marginBottom: 10 }}>
                    トレードリスト
                    <span style={{ marginLeft: 10, fontSize: 13, color: "#6b7280" }}>
                      {trades.length}件 / 勝: {trades.filter(t => t.pnl_pips > 0).length} / 負: {trades.filter(t => t.pnl_pips <= 0).length}
                    </span>
                    {(() => {
                      const total = Math.round(trades.reduce((s, t) => s + t.pnl_pips, 0) * 10) / 10;
                      return (
                        <span style={{ marginLeft: 12, fontSize: 13, fontWeight: 700, color: total >= 0 ? "#10b981" : "#ef4444" }}>
                          {total >= 0 ? `+${total}` : total} pips
                        </span>
                      );
                    })()}
                  </h3>
                  <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: trades.length > 12 ? 420 : undefined, marginBottom: 32 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: "#f3f4f6" }}>
                          {["#", "方向", "エントリー", "エグジット", "エントリー価格", "エグジット価格", "損益(pips)"].map(h => (
                            <th key={h} style={{ padding: "8px 10px", textAlign: "left", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {trades.map((t) => (
                          <tr
                            key={t.trade_id}
                            onClick={() => {
                              setHighlight({ date: t.entry_date, color: COLORS[si % COLORS.length] });
                              setCandleFocus({ strategyId: strategy.id, date: t.entry_date });
                            }}
                            style={{
                              cursor: "pointer",
                              background: highlight?.date === t.entry_date ? "#eef2ff" : "transparent",
                              borderBottom: "1px solid #f3f4f6",
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = "#f9fafb")}
                            onMouseLeave={e => (e.currentTarget.style.background = highlight?.date === t.entry_date ? "#eef2ff" : "transparent")}
                          >
                            <td style={{ padding: "7px 10px" }}>{t.trade_id + 1}</td>
                            <td style={{ padding: "7px 10px", color: t.direction === "long" ? "#10b981" : "#ef4444", fontWeight: 600 }}>
                              {t.direction === "long" ? "▲ ロング" : "▼ ショート"}
                            </td>
                            <td style={{ padding: "7px 10px" }}>{t.entry_date}</td>
                            <td style={{ padding: "7px 10px" }}>{t.exit_date}</td>
                            <td style={{ padding: "7px 10px" }}>{t.entry_price}</td>
                            <td style={{ padding: "7px 10px" }}>{t.exit_price}</td>
                            <td style={{ padding: "7px 10px", fontWeight: 600, color: t.pnl_pips > 0 ? "#10b981" : "#ef4444" }}>
                              {t.pnl_pips > 0 ? "+" : ""}{t.pnl_pips}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* ローソク足チャート */}
                  <h3 style={{ fontSize: 15, marginBottom: 12 }}>ローソク足チャート</h3>
                  <CandlestickChart
                    strategyId={strategy.id}
                    strategyName={strategy.name}
                    focusDate={candleFocus?.strategyId === strategy.id ? candleFocus.date : undefined}
                  />
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
