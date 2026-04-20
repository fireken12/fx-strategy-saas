from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.compare_snapshot import CompareSnapshotORM
from app.services.short_id import generate_short_id
from app.schemas.compare import CompareSnapshotCreate, CompareSnapshotResponse

router = APIRouter(prefix="/api/compare", tags=["compare"])


@router.post("/snapshots", response_model=CompareSnapshotResponse)
def create_snapshot(payload: CompareSnapshotCreate, db: Session = Depends(get_db)):
    short_id = generate_short_id()
    row = CompareSnapshotORM(
        short_id=short_id,
        ids_json=payload.strategy_ids,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "short_id": row.short_id,
        "strategy_ids": row.ids_json,
        "url_path": f"/compare/s/{row.short_id}",
    }


@router.get("/snapshots/{short_id}", response_model=CompareSnapshotResponse)
def get_snapshot(short_id: str, db: Session = Depends(get_db)):
    row = db.query(CompareSnapshotORM).filter_by(short_id=short_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="snapshot not found")
    return {
        "short_id": row.short_id,
        "strategy_ids": row.ids_json,
        "url_path": f"/compare/s/{row.short_id}",
    }
