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

## Settings

Global settings live at `/home/.ndx/settings.json`. Project settings live at `.ndx/settings.json` in the project directory. The repository includes a non-secret project settings file for the local LM Studio-compatible endpoint.

Do not put real provider, Tavily, GitHub, Docker Hub, npm, or GitLab tokens in repository files. Put secrets in `/home/.ndx/settings.json` on the local machine.

## Mock Agent

```bash
node dist/src/cli.js --mock "create a file named tmp/verify.txt with text verified"
```

## Real Agent

```bash
node dist/src/cli.js "inspect this repository and summarize the test command"
```

The active provider comes from settings. Empty provider keys are allowed for local OpenAI-compatible servers such as LM Studio.

## Docker

`npm run deploy` builds the Docker image from the current pushed Git branch, not from local source folders. Push the feature branch before running deploy. Compose stores runtime workspace and global settings under `./docker/volume`.

```bash
npm run deploy
```

Build another branch explicitly with:

```bash
NDX_GIT_REF=codex/example-feature docker compose build --no-cache ndx-agent
```

## Local OpenAI-Compatible Model

The project `.ndx/settings.json` defaults to:

- `provider`: `lmstudio`
- `url`: `http://192.168.0.6:12345/v1`
- `model`: `qwen3.6-35b-a3b:tr`

Start the container and run a one-shot prompt:

```bash
docker compose up -d --build ndx-agent
docker compose exec ndx-agent ndx "간단히 준비 완료라고 응답해"
```

Docker Desktop Exec tab also works after the container is running. Open the `ndx-agent` container and run:

```bash
ndx
```

That opens the ndx prompt. Submit tasks at `ndx>`, use `/help` for local commands, and `/exit` to leave. You can still run one-shot prompts with:

```bash
ndx "원하는 작업"
```

The default compose service stays alive with `sleep infinity` so interactive exec sessions can start `ndx` on demand. Files created by the agent persist in `./docker/volume/workspace`, and global settings persist in `./docker/volume/home-ndx`.
