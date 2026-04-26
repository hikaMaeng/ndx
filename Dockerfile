FROM node:22-bookworm-slim

WORKDIR /workspace
ENV NDX_HOME=/home/ndx/.ndx

COPY package.json pnpm-lock.yaml tsconfig.json ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY src ./src
COPY tests ./tests
COPY docs ./docs
RUN pnpm build

CMD ["node", "dist/src/cli.js", "--help"]
