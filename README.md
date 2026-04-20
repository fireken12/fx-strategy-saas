# FX戦略比較SaaS — MVP

## 前提

| ツール | バージョン |
|--------|-----------|
| Python | 3.11+ |
| Node.js | 20+ |
| PostgreSQL | 14+ |

---

## Backend セットアップ

```bash
cd backend

# 仮想環境
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

pip install --upgrade pip
pip install -r requirements.txt

# 環境変数
cp .env.example .env
# DATABASE_URL を必要に応じて編集

# DB作成（psql で）
createdb fx_strategy_saas

# マイグレーション
alembic upgrade head

# 起動
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

`http://localhost:8000/docs` でSwagger UIが確認できます。

---

## Frontend セットアップ

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

`http://localhost:5173` でUIが起動します。

---

## 動作確認シナリオ

### 1. API疎通

```bash
# スナップショット作成
curl -X POST http://localhost:8000/api/compare/snapshots \
  -H "Content-Type: application/json" \
  -d '{"strategy_ids":["stg1","stg2"]}'

# 取得（short_idは上記レスポンスから）
curl http://localhost:8000/api/compare/snapshots/<short_id>
```

### 2. UI E2E

1. `http://localhost:5173/compare` を開く
2. 「デモ戦略を2件作成して比較する」ボタンをクリック
3. 生成されたリンクを開く → エクイティ/ドローダウンチャートが表示される
4. 「共有URLをコピー」ボタン → トースト表示 + クリップボード保存
5. 新しいタブで `/compare/s/<shortId>` を開く → 比較画面が復元される
6. 不正URL `/compare/s/notfound123` → `/compare` にフォールバック

---

## テスト

```bash
cd backend
pytest -q tests/test_cache_utils.py
```

---

## ディレクトリ構成

```
fx-strategy-saas/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI エントリポイント
│   │   ├── api/compare.py       # スナップショット API
│   │   ├── api/strategies.py    # 戦略 CRUD + ダミーバックテスト
│   │   ├── models/              # SQLAlchemy ORM
│   │   ├── schemas/             # Pydantic スキーマ
│   │   ├── services/            # cache_utils, short_id
│   │   └── db/session.py        # DB接続
│   ├── alembic/                 # マイグレーション
│   ├── tests/
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── App.tsx
    │   ├── pages/               # StrategyComparePage, CompareSnapshotLoader
    │   ├── components/          # エクイティ/ドローダウンチャート
    │   ├── hooks/               # useCompareShare
    │   └── contexts/            # ToastContext
    └── vite.config.ts           # /api → :8000 proxy
```
