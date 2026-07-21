from fastapi import FastAPI

app = FastAPI(title="Closet API")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "closet-api"}
