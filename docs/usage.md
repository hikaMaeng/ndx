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
docker compose build ndx-agent
docker compose up --abort-on-container-exit ndx-agent
```

The default compose command uses:

- `OPENAI_BASE_URL=http://192.168.0.6:12345/v1`
- `NDX_MODEL=qwen3.6-35b-a3b:mm`
- `OPENAI_API_KEY=local`
