# Test Plan: settings-loader

## Goal

Verify ndx loads configuration only from `/home/.ndx/settings.json`, nearest project `.ndx/settings.json`, and global `/home/.ndx/search.json`, then runs through host and Docker paths without `.env` or OpenAI environment variables.

## Environment

- OS: Ubuntu 24.04 on WSL2
- Node: 22.22.2
- Docker: 29.3.1
- Compose: v5.1.0

## Preconditions

- Dependencies are installed with pnpm.
- Project `.ndx/settings.json` exists and contains no secrets.
- Docker daemon is running.

## Steps

1. Run `npm test`.
2. Run `npm run deploy`.
3. Run `docker compose up -d --build ndx-agent`.
4. Run `docker compose exec -T ndx-agent ndx --help`.
5. Run `docker compose exec ndx-agent ndx` with a TTY and exit with `/exit`.

## Expected Results

- Unit tests pass for fixed global path, nearest project settings discovery, search rule loading, and env/key merge.
- Deploy rebuilds Docker, runs in-container tests, and executes the mock agent.
- CLI help documents `settings.json` and `search.json` instead of `.env`, `.codex`, or `config.toml`.
- TTY startup prints `[config] /workspace/.ndx/settings.json`, the configured model, and `ndx>`.

## Logs To Capture

- TAP output from `npm test`.
- Docker deploy output for build, tests, and mock agent.
- `ndx --help` settings section.
- TTY welcome banner.
