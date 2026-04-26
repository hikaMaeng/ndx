FROM node:22-bookworm-slim

ARG NDX_GIT_REPO=https://github.com/hikaMaeng/ndx.git
ARG NDX_GIT_REF=main
ARG NDX_GIT_CACHE_BUST=manual

ENV NDX_GIT_REPO=${NDX_GIT_REPO}
ENV NDX_GIT_REF=${NDX_GIT_REF}
ENV NDX_GIT_CACHE_BUST=${NDX_GIT_CACHE_BUST}

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

RUN echo "Building ndx from ${NDX_GIT_REPO}@${NDX_GIT_REF} (${NDX_GIT_CACHE_BUST})" \
    && git clone --depth 1 --branch "${NDX_GIT_REF}" "${NDX_GIT_REPO}" /workspace

WORKDIR /workspace

RUN corepack enable \
    && pnpm install --frozen-lockfile \
    && mkdir -p /home/.ndx \
    && pnpm build \
    && chmod +x dist/src/cli.js \
    && ln -sf /workspace/dist/src/cli.js /usr/local/bin/ndx

CMD ["sleep", "infinity"]
