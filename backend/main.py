import logging
import os
import traceback

from dotenv import load_dotenv

load_dotenv()

# Configure root logger so app modules (backend.*) actually print INFO/WARNING.
# Uvicorn only sets up handlers for the `uvicorn.*` loggers; without this our
# `logger.info(...)` and `logger.exception(...)` calls in backend modules
# disappear silently, which makes debugging webhooks impossible.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
for noisy in ("httpx", "httpcore", "hpack", "urllib3"):
    logging.getLogger(noisy).setLevel(logging.WARNING)

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

from backend.automations.channel_router import router as dispatch_router
from backend.routes.accounts import router as accounts_router
from backend.routes.accounts_import import router as accounts_import_router
from backend.routes.agents import router as agents_router
from backend.routes.interventions import router as interventions_router
from backend.routes.playbooks import router as playbooks_router

app = FastAPI(title="Churn Oracle API")

# CORS: Vite dev + frontends + API host. CORSMiddleware also validates WebSocket Origin;
# Twilio Media Stream uses wss://API_HOST and sends Origin https://API_HOST — must be allowed or WS → 403.
_default_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    "http://hack.dark-army.lat",
    "https://hack.dark-army.lat",
    "http://backend.dark-army.lat",
    "https://backend.dark-army.lat",
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
app.include_router(interventions_router, prefix="/api/v1")
app.include_router(playbooks_router, prefix="/api/v1")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/v1/__diag/probe")
def diag_probe():
    """Dispara los webhooks de Make desde dentro del proceso uvicorn.

    Sirve para descartar problemas de red/DNS del lado del backend: si esto
    devuelve 200 por canal, el problema NO está aquí; si devuelve network_error
    sabemos que el server no puede salir a internet aunque el host sí pueda.
    """
    import httpx

    results: dict[str, dict] = {}
    for env_var, label in (
        ("MAKE_WEBHOOK_EMAIL", "email"),
        ("MAKE_WEBHOOK_SLACK", "slack"),
    ):
        url = os.environ.get(env_var)
        if not url:
            results[label] = {"error": f"{env_var} not set"}
            continue
        payload = {
            "intervention_id": f"DIAG-PROBE-{label.upper()}",
            "to": "deumc14@gmail.com",
            "to_name": "Diag",
            "subject": f"[DIAG] probe from uvicorn — {label}",
            "body": "Test desde el endpoint /__diag/probe — descartando network del backend.",
            "account_id": "DIAG",
            "account_name": "DIAG-PROBE",
            "slack_message_markdown": f"*[DIAG]* probe from uvicorn — {label}",
            "status": "sent",
            "auto_approved": True,
            "channel": label,
            "recipient": "deumc14@gmail.com",
            "trigger_reason": "diag",
            "confidence": 1.0,
            "playbook_id": "diag",
            "approval_reasoning": "diag",
            "agent_reasoning": "diag",
            "account_arr": 0,
            "account_industry": "diag",
            "account_plan": "diag",
        }
        try:
            r = httpx.post(url, json=payload, timeout=10.0)
            results[label] = {"status_code": r.status_code, "body": r.text[:200]}
        except Exception as exc:  # noqa: BLE001
            logger.exception("diag probe %s failed", label)
            results[label] = {"error": f"{type(exc).__name__}: {exc}"}
    return results


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


@app.exception_handler(Exception)
async def unhandled_exception_handler(request, exc: Exception) -> JSONResponse:
    """Catch-all for uncaught exceptions. Without this the response bypasses
    CORSMiddleware (no Access-Control-Allow-Origin) and the browser blocks it."""
    tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    logger.error("Unhandled exception on %s %s\n%s", request.method, request.url.path, tb)
    return JSONResponse(
        status_code=500,
        content={
            "error": "internal_error",
            "message": f"{type(exc).__name__}: {exc}",
            "details": {},
        },
    )
