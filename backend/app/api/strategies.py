import uuid as uuid_mod
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.strategy import StrategyORM
from app.schemas.strategy import (
    StrategyCreate, StrategyResponse, BacktestResponse,
    TradePoint, TradeRecord, CandlesResponse, CandlePoint, CandleMarker,
)
from app.services.backtest import (
    run_sma_crossover, run_rsi, run_macd, run_bollinger,
    get_candles_with_signals,
    _clamp_period, _fmt,
    _compute_sma, _compute_rsi, _compute_macd, _compute_bb,
    _fetch_data,
)

router = APIRouter(prefix="/api/strategies", tags=["strategies"])


@router.get("", response_model=list[StrategyResponse])
def list_strategies(db: Session = Depends(get_db)):
    rows = db.query(StrategyORM).all()
    return [StrategyResponse(id=str(r.id), name=r.name, description=r.description, params=r.params) for r in rows]


@router.post("", response_model=StrategyResponse)
def create_strategy(payload: StrategyCreate, db: Session = Depends(get_db)):
    row = StrategyORM(name=payload.name, description=payload.description, params=payload.params)
    db.add(row)
    db.commit()
    db.refresh(row)
    return StrategyResponse(id=str(row.id), name=row.name, description=row.description, params=row.params)


@router.get("/{strategy_id}", response_model=StrategyResponse)
def get_strategy(strategy_id: str, db: Session = Depends(get_db)):
    try:
        uid = uuid_mod.UUID(strategy_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="not found")
    row = db.query(StrategyORM).filter_by(id=uid).first()
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    return StrategyResponse(id=str(row.id), name=row.name, description=row.description, params=row.params)


@router.delete("/{strategy_id}", status_code=204)
def delete_strategy(strategy_id: str, db: Session = Depends(get_db)):
    try:
        uid = uuid_mod.UUID(strategy_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="not found")
    row = db.query(StrategyORM).filter_by(id=uid).first()
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    db.delete(row)
    db.commit()


@router.get("/{strategy_id}/backtest", response_model=BacktestResponse)
def run_backtest(strategy_id: str, db: Session = Depends(get_db)):
    try:
        uid = uuid_mod.UUID(strategy_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="not found")
    row = db.query(StrategyORM).filter_by(id=uid).first()
    if not row:
        raise HTTPException(status_code=404, detail="not found")

    p = row.params or {}
    symbol = p.get("symbol", "USDJPY=X")
    period = p.get("period", "1y")
    strategy_type = p.get("strategy_type", "sma_crossover")
    interval = p.get("interval", "1d")
    sl_pips = float(p.get("sl_pips", 0))
    tp_pips = float(p.get("tp_pips", 0))
    trade_direction = p.get("trade_direction", "both")

    if strategy_type == "rsi":
        result = run_rsi(
            symbol=symbol, rsi_period=int(p.get("rsi_period", 14)),
            oversold=int(p.get("oversold", 30)), overbought=int(p.get("overbought", 70)),
            period=period, interval=interval,
            sl_pips=sl_pips, tp_pips=tp_pips, trade_direction=trade_direction,
        )
    elif strategy_type == "macd":
        result = run_macd(
            symbol=symbol, fast=int(p.get("macd_fast", 12)),
            slow=int(p.get("macd_slow", 26)), signal_period=int(p.get("macd_signal", 9)),
            period=period, interval=interval,
            sl_pips=sl_pips, tp_pips=tp_pips, trade_direction=trade_direction,
        )
    elif strategy_type == "bollinger":
        result = run_bollinger(
            symbol=symbol, bb_period=int(p.get("bb_period", 20)),
            bb_std=float(p.get("bb_std", 2.0)),
            period=period, interval=interval,
            sl_pips=sl_pips, tp_pips=tp_pips, trade_direction=trade_direction,
        )
    else:
        result = run_sma_crossover(
            symbol=symbol, sma_short=int(p.get("sma_short", 5)),
            sma_long=int(p.get("sma_long", 20)),
            period=period, interval=interval,
            sl_pips=sl_pips, tp_pips=tp_pips, trade_direction=trade_direction,
        )

    if not result:
        raise HTTPException(status_code=502, detail="価格データの取得に失敗しました")

    trades = [TradePoint(**pt) for pt in result["equity"]]
    trade_list = [TradeRecord(**t) for t in result.get("trade_list", [])]
    return BacktestResponse(strategy_id=strategy_id, trades=trades, trade_list=trade_list)


@router.get("/{strategy_id}/candles", response_model=CandlesResponse)
def get_candles(strategy_id: str, interval: str = "1d", period: str = "1y", db: Session = Depends(get_db)):
    try:
        uid = uuid_mod.UUID(strategy_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="not found")
    row = db.query(StrategyORM).filter_by(id=uid).first()
    if not row:
        raise HTTPException(status_code=404, detail="not found")

    p = row.params or {}
    symbol = p.get("symbol", "USDJPY=X")
    strategy_type = p.get("strategy_type", "sma_crossover")
    trade_direction = p.get("trade_direction", "both")

    # Display candles use the requested interval
    display_period = _clamp_period(interval, period)
    df_display = _fetch_data(symbol, interval, display_period)
    if df_display.empty:
        raise HTTPException(status_code=502, detail="価格データの取得に失敗しました")

    # Signal calculation uses the strategy's native interval
    native_interval = p.get("interval", "1d")
    native_period = _clamp_period(native_interval, p.get("period", "1y"))
    df_native = _fetch_data(symbol, native_interval, native_period) if native_interval != interval else df_display.copy()
    if df_native.empty:
        df_native = df_display.copy()

    # Compute signals on native interval
    if strategy_type == "rsi":
        _compute_rsi(df_native, int(p.get("rsi_period", 14)), int(p.get("oversold", 30)), int(p.get("overbought", 70)), trade_direction)
    elif strategy_type == "macd":
        _compute_macd(df_native, int(p.get("macd_fast", 12)), int(p.get("macd_slow", 26)), int(p.get("macd_signal", 9)), trade_direction)
    elif strategy_type == "bollinger":
        _compute_bb(df_native, int(p.get("bb_period", 20)), float(p.get("bb_std", 2.0)), trade_direction)
    else:
        _compute_sma(df_native, int(p.get("sma_short", 5)), int(p.get("sma_long", 20)), trade_direction)

    df_native["position"] = df_native["signal"].shift(1)
    native_result = get_candles_with_signals(df_native, symbol, native_interval)

    # Build display candles
    candles = [
        CandlePoint(
            time=_fmt(idx, interval),
            open=round(float(r["Open"]), 5),
            high=round(float(r["High"]), 5),
            low=round(float(r["Low"]), 5),
            close=round(float(r["Close"]), 5),
        )
        for idx, r in df_display.dropna(subset=["Open", "High", "Low", "Close"]).iterrows()
    ]

    markers = [CandleMarker(**m) for m in native_result["markers"]]

    # Build indicators
    indicators: dict = {}
    if strategy_type == "rsi":
        indicators["rsi"] = [{"time": _fmt(idx, native_interval), "value": round(float(v), 2)} for idx, v in df_native["rsi"].dropna().items()]
        indicators["oversold"] = int(p.get("oversold", 30))
        indicators["overbought"] = int(p.get("overbought", 70))
    elif strategy_type == "macd":
        indicators["macd"] = [{"time": _fmt(idx, native_interval), "value": round(float(v), 6)} for idx, v in df_native["macd"].dropna().items()]
        indicators["macd_signal"] = [{"time": _fmt(idx, native_interval), "value": round(float(v), 6)} for idx, v in df_native["macd_signal"].dropna().items()]
    elif strategy_type == "bollinger":
        indicators["bb_upper"] = [{"time": _fmt(idx, native_interval), "value": round(float(v), 5)} for idx, v in df_native["bb_upper"].dropna().items()]
        indicators["bb_mid"] = [{"time": _fmt(idx, native_interval), "value": round(float(v), 5)} for idx, v in df_native["bb_mid"].dropna().items()]
        indicators["bb_lower"] = [{"time": _fmt(idx, native_interval), "value": round(float(v), 5)} for idx, v in df_native["bb_lower"].dropna().items()]
    else:
        indicators["sma_short"] = [{"time": _fmt(idx, native_interval), "value": round(float(v), 5)} for idx, v in df_native["sma_s"].dropna().items()]
        indicators["sma_long"] = [{"time": _fmt(idx, native_interval), "value": round(float(v), 5)} for idx, v in df_native["sma_l"].dropna().items()]

    return CandlesResponse(
        strategy_id=strategy_id,
        interval=interval,
        strategy_type=strategy_type,
        candles=candles,
        markers=markers,
        indicators=indicators,
    )
