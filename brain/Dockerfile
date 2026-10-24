# Build from the REPO ROOT: az acr build --registry <acr> --image kite-brain:latest -f brain/Dockerfile .
#
# The image mirrors the repo layout under /app, so the brain's relative paths work as they do locally:
#   /app/brain             the working directory: data/kite.db, data/creations/ resolve here
#   /app/COLLAB_LOG.md     read at startup for "how were you built?"
#   /app/docs/trust/       the Trust tab's eval files
#   /app/packages/movie    the MP4 renderer, run as `node packages/movie/render.mjs` (symlinked into brain/)
# One replica only: the event bus is in memory. Scaling out needs Redis pub/sub.
FROM python:3.12-slim-bookworm

# Node 24 for the renderer, and the shared libraries Remotion's headless Chromium needs.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg \
        libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libasound2 libxrandr2 libxkbcommon0 libxfixes3 \
        libxcomposite1 libxdamage1 libgbm1 libcups2 libpango-1.0-0 libcairo2 \
    && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv

WORKDIR /app/brain
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PATH="/app/brain/.venv/bin:$PATH"

# Dependencies first, so a code change doesn't reinstall them.
COPY brain/pyproject.toml brain/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY brain/kite_brain ./kite_brain
RUN uv sync --frozen --no-dev

# packages/movie may not exist yet; the install is skipped until it does.
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
RUN if [ -d packages/movie ]; then npm ci --omit=dev -w packages/movie; fi \
    && ln -s ../packages /app/brain/packages

# Optional files. Each bracket glob matches nothing when the file is absent, and COPY needs
# one source that exists (COLLAB_LOG.md), so a missing snapshot, vectors or trust dir doesn't fail the build.
# The directory's files land flat in /stage and are put in place below.
COPY COLLAB_LOG.md docs/trus[t] brain/data/demo-snapshot.d[b] brain/data/concept_vectors.np[y] /stage/
RUN mkdir -p /app/docs/trust /app/brain/data \
    && mv /stage/COLLAB_LOG.md /app/ \
    && if [ -f /stage/demo-snapshot.db ]; then mv /stage/demo-snapshot.db /app/brain/data/kite.db; fi \
    && if [ -f /stage/concept_vectors.npy ]; then mv /stage/concept_vectors.npy /app/brain/data/; fi \
    && for f in /stage/*; do if [ -e "$f" ]; then mv "$f" /app/docs/trust/; fi; done \
    && rmdir /stage

WORKDIR /app/brain
EXPOSE 8000
CMD ["uvicorn", "kite_brain.api:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
