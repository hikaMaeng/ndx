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
    && chmod +x dist/src/cli.js \
    && ln -sf /opt/ndx/dist/src/cli.js /usr/local/bin/ndx

WORKDIR /workspace

CMD ["sleep", "infinity"]
