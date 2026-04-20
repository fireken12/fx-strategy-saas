from pydantic import BaseModel
from typing import Any, Dict, List, Optional
import uuid


class StrategyCreate(BaseModel):
    name: str
    description: Optional[str] = None
    params: Dict[str, Any] = {}


class StrategyResponse(BaseModel):
    id: str
    name: str
    description: Optional[str]
    params: Dict[str, Any]

    model_config = {"from_attributes": True}


class TradePoint(BaseModel):
    t: int
    date: Optional[str] = None
    equity: float
    drawdown: float
    session: Optional[str] = None


class TradeRecord(BaseModel):
    trade_id: int
    direction: str
    entry_date: str
    exit_date: str
    entry_price: float
    exit_price: float
    pnl_pips: float
    session: Optional[str] = None


class BacktestResponse(BaseModel):
    strategy_id: str
    trades: List[TradePoint]
    trade_list: List[TradeRecord] = []


class CandlePoint(BaseModel):
    time: str
    open: float
    high: float
    low: float
    close: float


class CandleMarker(BaseModel):
    time: str
    direction: str  # "long" | "short"
    action: str     # "entry" | "exit"


class IndicatorPoint(BaseModel):
    time: str
    value: float


class CandlesResponse(BaseModel):
    strategy_id: str
    interval: str
    strategy_type: str
    candles: List[CandlePoint]
    markers: List[CandleMarker] = []
    indicators: dict = {}  # {"sma_short": [...], "sma_long": [...]} or {"rsi": [...]}
