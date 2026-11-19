# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS studio-build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npx --yes npm@10.9.9 ci --no-audit --no-fund
COPY next.config.ts postcss.config.mjs tsconfig.json ./
COPY src ./src
COPY public ./public
COPY migrations ./migrations
RUN npm run build && npx --yes npm@10.9.9 prune --omit=dev

FROM node:22-bookworm-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates ffmpeg git zip \
    && rm -rf /var/lib/apt/lists/*
ENV UV_PYTHON_INSTALL_DIR=/opt/python UV_CACHE_DIR=/tmp/uv-cache
RUN mkdir -p /opt/hermes && git -C /opt/hermes init -q \
    && git -C /opt/hermes fetch --depth=1 https://github.com/NousResearch/hermes-agent.git 3371c03df62106a4c93a545787a471e328883d08 \
    && git -C /opt/hermes checkout -q FETCH_HEAD \
    && cd /opt/hermes && uv sync --frozen --no-dev --extra anthropic --extra mcp --python 3.14 \
    && uv pip install --python .venv/bin/python aiohttp==3.14.5 \
    && rm -rf /tmp/uv-cache /opt/hermes/.git
WORKDIR /app
COPY --from=studio-build /app/package.json /app/next.config.ts ./
COPY --from=studio-build /app/.next ./.next
COPY --from=studio-build /app/node_modules ./node_modules
COPY --from=studio-build /app/public ./public
COPY --from=studio-build /app/migrations ./migrations
COPY scripts/studio-hosted.mjs scripts/studio-hosted.py ./scripts/
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PARALLAX_DATA_DIR=/data
EXPOSE 8080
CMD ["/opt/hermes/.venv/bin/python", "/app/scripts/studio-hosted.py"]
