import os

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.routes.agents import router as agents_router
from backend.routes.accounts import router as accounts_router
from backend.routes.accounts_import import router as accounts_import_router
from backend.routes.dispatch import router as dispatch_router
from backend.routes.playbooks import router as playbooks_router

app = FastAPI(title="Churn Oracle API")

# CORS: allow the Vite dev server (and any extra origins via FRONTEND_ORIGINS env, comma-separated)
_default_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
]
_extra = [o.strip() for o in os.environ.get("FRONTEND_ORIGINS", "").split(",") if o.strip()]
_allow_origins = list({*_default_origins, *_extra})

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(accounts_import_router, prefix="/api/v1")
app.include_router(accounts_router, prefix="/api/v1")
app.include_router(agents_router, prefix="/api/v1")
app.include_router(dispatch_router, prefix="/api/v1")
app.include_router(playbooks_router, prefix="/api/v1")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.exception_handler(HTTPException)
async def http_exception_handler(_request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail
    if isinstance(detail, dict) and "error" in detail and "message" in detail:
        return JSONResponse(status_code=exc.status_code, content=detail)
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": "http_error", "message": str(detail), "details": {}},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "error": "validation_error",
            "message": "Request validation failed",
            "details": {"errors": exc.errors()},
        },
    )
