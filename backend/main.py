from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI

from backend.routes.agents import router as agents_router

app = FastAPI()
app.include_router(agents_router)


@app.get("/health")
def health():
    return {"status": "ok"}
