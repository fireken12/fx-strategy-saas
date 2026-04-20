from pydantic import BaseModel
from typing import List


class CompareSnapshotCreate(BaseModel):
    strategy_ids: List[str]


class CompareSnapshotResponse(BaseModel):
    short_id: str
    strategy_ids: List[str]
    url_path: str
