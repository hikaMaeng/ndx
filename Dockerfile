FROM node:22-bookworm-slim

ARG NDX_GIT_REF=main
ENV NDX_GIT_REF=${NDX_GIT_REF}

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

RUN echo "Building ndx from https://github.com/hikaMaeng/ndx.git@${NDX_GIT_REF}" \
    && git clone --depth 1 --branch "${NDX_GIT_REF}" "https://github.com/hikaMaeng/ndx.git" /opt/ndx

WORKDIR /opt/ndx

RUN corepack enable \
    && pnpm install --frozen-lockfile \
    && mkdir -p /home/.ndx /workspace \
    && pnpm build \
    && chmod +x dist/src/cli/main.js \
    && ln -sf /opt/ndx/dist/src/cli/main.js /usr/local/bin/ndx

WORKDIR /workspace

CMD set -eu; \
    cd /opt/ndx; \
    echo "[ndx-image] package=$(node -p "const p=require('./package.json'); p.name + '@' + p.version")"; \
    echo "[ndx-image] git_remote=https://github.com/hikaMaeng/ndx.git"; \
    echo "[ndx-image] git_ref=${NDX_GIT_REF}"; \
    echo "[ndx-image] git_commit=$(git rev-parse HEAD)"; \
    echo "[ndx-image] git_branch=$(git branch --show-current)"; \
    git log -1 --format='[ndx-image] git_commit_date=%cI%n[ndx-image] git_subject=%s'; \
    echo "[ndx-image] node=$(node --version) pnpm=$(pnpm --version)"; \
    exec sleep infinity
