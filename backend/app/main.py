import os
import logging
import traceback
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from app.api import compare, strategies

load_dotenv()

logger = logging.getLogger("app")

app = FastAPI(title="FX Strategy SaaS", version="0.1.0")

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        FRONTEND_ORIGIN,
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Log full traceback and return JSON with CORS-compatible response.
    Without this, 500 responses bypass CORSMiddleware header injection
    and the browser reports a confusing CORS error instead of the real cause."""
    logger.error("Unhandled exception on %s %s", request.method, request.url.path)
    logger.error(traceback.format_exc())
    return JSONResponse(
        status_code=500,
        content={"detail": f"internal error: {type(exc).__name__}: {exc}"},
    )


app.include_router(compare.router)
app.include_router(strategies.router)


@app.get("/health")
def health():
    return {"status": "ok"}
