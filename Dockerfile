FROM node:22-bookworm-slim

WORKDIR /workspace

COPY package.json pnpm-lock.yaml tsconfig.json ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY src ./src
COPY tests ./tests
COPY docs ./docs
COPY .ndx ./.ndx
RUN mkdir -p /home/.ndx \
    && pnpm build \
    && chmod +x dist/src/cli.js \
    && ln -sf /workspace/dist/src/cli.js /usr/local/bin/ndx

CMD ["sleep", "infinity"]
