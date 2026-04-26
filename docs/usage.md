# Usage

## Install

```bash
pnpm install --registry=https://registry.npmjs.org
```

The explicit registry is useful when local Verdaccio is unavailable.

## Build And Test

```bash
npm test
```

## Mock Agent

```bash
node dist/src/cli.js --mock "create a file named tmp/verify.txt with text verified"
```

## Real Agent

```bash
export OPENAI_API_KEY=...
node dist/src/cli.js "inspect this repository and summarize the test command"
```

## Docker

```bash
npm run deploy
```

## Local OpenAI-Compatible Model

Create `.env` from `.env.example` and adjust the endpoint if needed:

```bash
cp .env.example .env
docker compose up -d --build ndx-agent
docker compose exec ndx-agent ndx "간단히 준비 완료라고 응답해"
```

Docker Desktop Exec tab also works after the container is running. Open the `ndx-agent` container and run:

```bash
ndx "원하는 작업"
```

The default compose service stays alive with `sleep infinity` so interactive exec sessions can start `ndx` on demand.

The default compose environment uses:

- `OPENAI_BASE_URL=http://192.168.0.6:12345/v1`
- `NDX_MODEL=qwen3.6-35b-a3b:mm`
- `OPENAI_API_KEY=local`
