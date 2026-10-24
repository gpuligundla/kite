from fastapi import FastAPI


def create_app() -> FastAPI:
    app = FastAPI(title="Kite brain")

    @app.get("/health")
    def health() -> dict[str, bool]:
        return {"ok": True}

    return app
