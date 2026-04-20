import time
import yfinance as yf
import pandas as pd
from typing import List, Dict, Any, Optional

try:
    from curl_cffi import requests as curl_requests
    _HAS_CURL_CFFI = True
except ImportError:
    _HAS_CURL_CFFI = False

# ---------------------------------------------------------------------------
# In-memory cache for Yahoo Finance data (1h TTL)
# ---------------------------------------------------------------------------
_df_cache: Dict = {}
_CACHE_TTL = 3600


def _build_session():
    """Return a curl_cffi session impersonating a real browser to avoid
    Yahoo Finance blocking cloud IP ranges. Falls back to None (yfinance
    default) if curl_cffi is not available."""
    if not _HAS_CURL_CFFI:
        return None
    return curl_requests.Session(impersonate="chrome")


def _fetch_data(symbol: str, interval: str, period: str) -> pd.DataFrame:
    key = (symbol, interval, period)
    now = time.time()
    if key in _df_cache:
        ts, df = _df_cache[key]
        if now - ts < _CACHE_TTL:
            return df.copy()
    session = _build_session()
    ticker = yf.Ticker(symbol, session=session) if session else yf.Ticker(symbol)
    df = ticker.history(period=period, interval=interval)
    if not df.empty:
        _df_cache[key] = (now, df)
    return df.copy()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_session(hour_utc: int) -> str:
    if 0 <= hour_utc < 8:
        return "tokyo"
    elif 8 <= hour_utc < 13:
        return "london"
    elif 13 <= hour_utc < 22:
        return "ny"
    return "dead"


def _clamp_period(interval: str, period: str) -> str:
    limits = {"30m": "60d", "1h": "2y"}
    max_period = limits.get(interval)
    if not max_period:
        return period
    order = ["7d", "60d", "6mo", "1y", "2y", "5y"]
    if period not in order or order.index(period) > order.index(max_period):
        return max_period
    return period


def _fmt(idx, interval: str) -> str:
    return idx.strftime("%Y-%m-%d %H:%M") if interval != "1d" else idx.strftime("%Y-%m-%d")


def _apply_direction(df: pd.DataFrame, trade_direction: str) -> None:
    if trade_direction == "long_only":
        df.loc[df["signal"] < 0, "signal"] = 0
    elif trade_direction == "short_only":
        df.loc[df["signal"] > 0, "signal"] = 0


# ---------------------------------------------------------------------------
# Signal computation (shared by run_* and candles endpoint)
# ---------------------------------------------------------------------------

def _compute_sma(df: pd.DataFrame, sma_short: int, sma_long: int, trade_direction: str = "both") -> None:
    df["sma_s"] = df["Close"].rolling(sma_short).mean()
    df["sma_l"] = df["Close"].rolling(sma_long).mean()
    df["signal"] = 0
    df.loc[df["sma_s"] > df["sma_l"], "signal"] = 1
    df.loc[df["sma_s"] < df["sma_l"], "signal"] = -1
    _apply_direction(df, trade_direction)


def _compute_rsi(df: pd.DataFrame, rsi_period: int, oversold: int, overbought: int, trade_direction: str = "both") -> None:
    delta = df["Close"].diff()
    gain = delta.clip(lower=0).rolling(rsi_period).mean()
    loss = (-delta.clip(upper=0)).rolling(rsi_period).mean()
    rs = gain / loss.replace(0, float("nan"))
    df["rsi"] = 100 - (100 / (1 + rs))
    df["signal"] = 0
    df.loc[df["rsi"] < oversold, "signal"] = 1
    df.loc[df["rsi"] > overbought, "signal"] = -1
    _apply_direction(df, trade_direction)


def _compute_macd(df: pd.DataFrame, fast: int, slow: int, signal_period: int, trade_direction: str = "both") -> None:
    df["macd"] = df["Close"].ewm(span=fast, adjust=False).mean() - df["Close"].ewm(span=slow, adjust=False).mean()
    df["macd_signal"] = df["macd"].ewm(span=signal_period, adjust=False).mean()
    df["macd_hist"] = df["macd"] - df["macd_signal"]
    df["signal"] = 0
    df.loc[df["macd"] > df["macd_signal"], "signal"] = 1
    df.loc[df["macd"] < df["macd_signal"], "signal"] = -1
    _apply_direction(df, trade_direction)


def _compute_bb(df: pd.DataFrame, bb_period: int, bb_std_mult: float, trade_direction: str = "both") -> None:
    """ボリンジャーバンド: バンドタッチでエントリー、中心線でエグジット"""
    df["bb_mid"] = df["Close"].rolling(bb_period).mean()
    df["bb_std_val"] = df["Close"].rolling(bb_period).std()
    df["bb_upper"] = df["bb_mid"] + bb_std_mult * df["bb_std_val"]
    df["bb_lower"] = df["bb_mid"] - bb_std_mult * df["bb_std_val"]

    signals = [0] * len(df)
    in_long = False
    in_short = False

    for i, (_, row) in enumerate(df.iterrows()):
        if pd.isna(row["bb_mid"]):
            continue
        if in_long:
            if row["Close"] >= row["bb_mid"]:
                in_long = False
            else:
                signals[i] = 1
        elif in_short:
            if row["Close"] <= row["bb_mid"]:
                in_short = False
            else:
                signals[i] = -1
        else:
            if row["Close"] < row["bb_lower"]:
                in_long = True
                signals[i] = 1
            elif row["Close"] > row["bb_upper"]:
                in_short = True
                signals[i] = -1

    df["signal"] = signals
    _apply_direction(df, trade_direction)


# ---------------------------------------------------------------------------
# Trade extraction
# ---------------------------------------------------------------------------

def _extract_trades(
    df: pd.DataFrame,
    symbol: str,
    interval: str,
    sl_pips: float = 0,
    tp_pips: float = 0,
) -> List[Dict[str, Any]]:
    pip_factor = 100 if "JPY" in symbol.upper() else 10000
    sl_delta = sl_pips / pip_factor if sl_pips else None
    tp_delta = tp_pips / pip_factor if tp_pips else None
    is_intraday = interval != "1d"

    trades = []
    trade_id = 0
    in_trade = False
    entry_idx = entry_price = direction = None
    prev_pos = 0.0

    for idx, row in df.dropna(subset=["position", "Close"]).iterrows():
        pos = float(row["position"])
        close = float(row["Close"])
        high = float(row["High"]) if "High" in row and pd.notna(row["High"]) else close
        low = float(row["Low"]) if "Low" in row and pd.notna(row["Low"]) else close

        sltp_exit_price = None
        if in_trade and (sl_delta or tp_delta):
            if direction == "long":
                if sl_delta and low <= entry_price - sl_delta:
                    sltp_exit_price = round(entry_price - sl_delta, 5)
                elif tp_delta and high >= entry_price + tp_delta:
                    sltp_exit_price = round(entry_price + tp_delta, 5)
            else:
                if sl_delta and high >= entry_price + sl_delta:
                    sltp_exit_price = round(entry_price + sl_delta, 5)
                elif tp_delta and low <= entry_price - tp_delta:
                    sltp_exit_price = round(entry_price - tp_delta, 5)

        if sltp_exit_price is not None:
            pnl = (sltp_exit_price - entry_price) * (1 if direction == "long" else -1) * pip_factor
            trades.append({
                "trade_id": trade_id,
                "direction": direction,
                "entry_date": _fmt(entry_idx, interval),
                "exit_date": _fmt(idx, interval),
                "entry_price": round(entry_price, 5),
                "exit_price": sltp_exit_price,
                "pnl_pips": round(pnl, 1),
                "session": _get_session(entry_idx.hour) if is_intraday else None,
            })
            trade_id += 1
            in_trade = False
            entry_idx = entry_price = direction = None
            prev_pos = 0.0
            continue

        if not in_trade and pos != 0:
            in_trade = True
            entry_idx, entry_price, direction = idx, close, ("long" if pos > 0 else "short")
        elif in_trade and (pos == 0 or pos != prev_pos):
            pnl = (close - entry_price) * (1 if direction == "long" else -1) * pip_factor
            trades.append({
                "trade_id": trade_id,
                "direction": direction,
                "entry_date": _fmt(entry_idx, interval),
                "exit_date": _fmt(idx, interval),
                "entry_price": round(entry_price, 5),
                "exit_price": round(close, 5),
                "pnl_pips": round(pnl, 1),
                "session": _get_session(entry_idx.hour) if is_intraday else None,
            })
            trade_id += 1
            if pos != 0:
                entry_idx, entry_price, direction = idx, close, ("long" if pos > 0 else "short")
            else:
                in_trade = False

        prev_pos = pos

    return trades


def _to_equity_series(df: pd.DataFrame, symbol: str, interval: str) -> List[Dict[str, Any]]:
    pip_factor = 100 if "JPY" in symbol.upper() else 10000
    df["pnl_pips"] = df["strat_ret"] * df["Close"].shift(1) * pip_factor
    df = df.dropna(subset=["pnl_pips"])

    is_intraday = interval != "1d"
    equity = 0.0
    peak = 0.0
    result = []

    for i, (idx, row) in enumerate(df.iterrows()):
        equity += row["pnl_pips"]
        peak = max(peak, equity)
        point: Dict[str, Any] = {
            "t": i,
            "date": _fmt(idx, interval),
            "equity": round(equity, 2),
            "drawdown": round(equity - peak, 2),
        }
        if is_intraday:
            point["session"] = _get_session(idx.hour)
        result.append(point)

    return result


def get_candles_with_signals(df: pd.DataFrame, symbol: str, interval: str):
    candles = []
    for idx, row in df.dropna(subset=["Open", "High", "Low", "Close"]).iterrows():
        candles.append({
            "time": _fmt(idx, interval),
            "open": round(float(row["Open"]), 5),
            "high": round(float(row["High"]), 5),
            "low": round(float(row["Low"]), 5),
            "close": round(float(row["Close"]), 5),
        })

    markers = []
    prev_pos = 0.0
    for idx, row in df.dropna(subset=["position"]).iterrows():
        pos = float(row["position"])
        if pos != prev_pos:
            if prev_pos != 0:
                markers.append({
                    "time": _fmt(idx, interval),
                    "direction": "long" if prev_pos > 0 else "short",
                    "action": "exit",
                })
            if pos != 0:
                markers.append({
                    "time": _fmt(idx, interval),
                    "direction": "long" if pos > 0 else "short",
                    "action": "entry",
                })
        prev_pos = pos

    return {"candles": candles, "markers": markers}


def _build_result(df: pd.DataFrame, symbol: str, interval: str, sl_pips: float = 0, tp_pips: float = 0):
    equity = _to_equity_series(df, symbol, interval)
    trades = _extract_trades(df, symbol, interval, sl_pips, tp_pips)
    return {"equity": equity, "trade_list": trades}


# ---------------------------------------------------------------------------
# Public run functions
# ---------------------------------------------------------------------------

def run_sma_crossover(
    symbol: str = "USDJPY=X", sma_short: int = 5, sma_long: int = 20,
    period: str = "1y", interval: str = "1d",
    sl_pips: float = 0, tp_pips: float = 0, trade_direction: str = "both",
) -> Dict[str, Any]:
    period = _clamp_period(interval, period)
    df = _fetch_data(symbol, interval, period)
    if df.empty:
        return {}
    _compute_sma(df, sma_short, sma_long, trade_direction)
    df["position"] = df["signal"].shift(1)
    df["ret"] = df["Close"].pct_change()
    df["strat_ret"] = df["position"] * df["ret"]
    return _build_result(df, symbol, interval, sl_pips, tp_pips)


def run_rsi(
    symbol: str = "USDJPY=X", rsi_period: int = 14, oversold: int = 30, overbought: int = 70,
    period: str = "1y", interval: str = "1d",
    sl_pips: float = 0, tp_pips: float = 0, trade_direction: str = "both",
) -> Dict[str, Any]:
    period = _clamp_period(interval, period)
    df = _fetch_data(symbol, interval, period)
    if df.empty:
        return {}
    _compute_rsi(df, rsi_period, oversold, overbought, trade_direction)
    df["position"] = df["signal"].shift(1)
    df["ret"] = df["Close"].pct_change()
    df["strat_ret"] = df["position"] * df["ret"]
    return _build_result(df, symbol, interval, sl_pips, tp_pips)


def run_macd(
    symbol: str = "USDJPY=X", fast: int = 12, slow: int = 26, signal_period: int = 9,
    period: str = "1y", interval: str = "1d",
    sl_pips: float = 0, tp_pips: float = 0, trade_direction: str = "both",
) -> Dict[str, Any]:
    period = _clamp_period(interval, period)
    df = _fetch_data(symbol, interval, period)
    if df.empty:
        return {}
    _compute_macd(df, fast, slow, signal_period, trade_direction)
    df["position"] = df["signal"].shift(1)
    df["ret"] = df["Close"].pct_change()
    df["strat_ret"] = df["position"] * df["ret"]
    return _build_result(df, symbol, interval, sl_pips, tp_pips)


def run_bollinger(
    symbol: str = "USDJPY=X", bb_period: int = 20, bb_std: float = 2.0,
    period: str = "1y", interval: str = "1d",
    sl_pips: float = 0, tp_pips: float = 0, trade_direction: str = "both",
) -> Dict[str, Any]:
    period = _clamp_period(interval, period)
    df = _fetch_data(symbol, interval, period)
    if df.empty:
        return {}
    _compute_bb(df, bb_period, bb_std, trade_direction)
    df["position"] = df["signal"].shift(1)
    df["ret"] = df["Close"].pct_change()
    df["strat_ret"] = df["position"] * df["ret"]
    return _build_result(df, symbol, interval, sl_pips, tp_pips)
