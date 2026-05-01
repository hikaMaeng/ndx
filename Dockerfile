FROM node:22-bookworm-slim

ARG NDX_GIT_REF=main
ENV NDX_GIT_REF=${NDX_GIT_REF}
ENV NDX_SOCKET_HOST=0.0.0.0
ENV NDX_SOCKET_PORT=45123
ENV NDX_DASHBOARD_HOST=0.0.0.0
ENV NDX_DASHBOARD_PORT=45124
ENV NDX_PUBLIC_SOCKET_URL=ws://127.0.0.1:45123
ENV NDX_PUBLIC_DASHBOARD_URL=http://127.0.0.1:45124

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

RUN echo "Building ndx from https://github.com/hikaMaeng/ndx.git@${NDX_GIT_REF}" \
    && git clone --depth 1 --branch "${NDX_GIT_REF}" "https://github.com/hikaMaeng/ndx.git" /opt/ndx

WORKDIR /opt/ndx

RUN corepack enable \
    && yarn install --immutable \
    && mkdir -p /home/.ndx /workspace \
    && yarn build \
    && chmod +x dist/src/cli/main.js \
    && ln -sf /opt/ndx/dist/src/cli/main.js /usr/local/bin/ndx \
    && ln -sf /opt/ndx/dist/src/cli/main.js /usr/local/bin/ndxserver

WORKDIR /workspace

CMD set -eu; \
    cd /opt/ndx; \
    echo "[ndx-image] package=$(node -p "const p=require('./package.json'); p.name + '@' + p.version")"; \
    echo "[ndx-image] git_remote=https://github.com/hikaMaeng/ndx.git"; \
    echo "[ndx-image] git_ref=${NDX_GIT_REF}"; \
    echo "[ndx-image] git_commit=$(git rev-parse HEAD)"; \
    echo "[ndx-image] git_branch=$(git branch --show-current)"; \
    git --no-pager log -1 --format='[ndx-image] git_commit_date=%cI%n[ndx-image] git_subject=%s'; \
    echo "[ndx-image] node=$(node --version) yarn=$(yarn --version)"; \
    echo "[ndx-service] socket_bind=${NDX_SOCKET_HOST}:${NDX_SOCKET_PORT}"; \
    echo "[ndx-service] dashboard_bind=${NDX_DASHBOARD_HOST}:${NDX_DASHBOARD_PORT}"; \
    echo "[ndx-service] socket_url=${NDX_PUBLIC_SOCKET_URL}"; \
    echo "[ndx-service] dashboard_url=${NDX_PUBLIC_DASHBOARD_URL}"; \
    echo "[ndx-service] cwd=/workspace"; \
    exec ndxserver --mock --cwd /workspace --listen "${NDX_SOCKET_HOST}:${NDX_SOCKET_PORT}" --dashboard-listen "${NDX_DASHBOARD_HOST}:${NDX_DASHBOARD_PORT}"
