# The kite-studio hosted agent: Python handler, Claude Code on Node 24, Playwright Chromium, and two
# kits: Phaser, KAPLAY and GSAP for games, GSAP for director's-cut movies. Both share one browser.
# Build in ACR with scripts/deploy-studio-agent.sh (no local Docker needed).
FROM python:3.12-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    KIT_DIR=/opt/game-kit \
    MOVIE_KIT_DIR=/opt/movie-kit

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg git \
 && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && npm install -g @anthropic-ai/claude-code@2.1.310 \
 && rm -rf /var/lib/apt/lists/*

COPY game-kit/package.json game-kit/package-lock.json /opt/game-kit/
RUN cd /opt/game-kit \
 && npm ci --no-audit --no-fund \
 && npx playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*
COPY game-kit/ /opt/game-kit/

COPY movie-kit/package.json movie-kit/package-lock.json /opt/movie-kit/
RUN cd /opt/movie-kit && npm ci --no-audit --no-fund
COPY movie-kit/ /opt/movie-kit/

RUN pip install --no-cache-dir \
      claude-agent-sdk==0.2.174 \
      azure-ai-agentserver-invocations==1.2.0 \
      azure-identity==1.26.0

RUN useradd -m agent && chown -R agent /opt/game-kit /opt/movie-kit /ms-playwright
COPY agent.py instructions.md movie-instructions.md /app/
WORKDIR /app
USER agent
ENV HOME=/home/agent \
    KITE_WORK_HOME=/home/agent
EXPOSE 8088
CMD ["python", "agent.py"]
