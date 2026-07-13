"""Valid import with an intentional ASGI startup failure for rollback rehearsal."""
from fastapi import FastAPI

app = FastAPI()


@app.on_event("startup")
async def intentional_startup_failure() -> None:
    raise RuntimeError("MIRAX_INTENTIONAL_ROLLBACK_REHEARSAL")
