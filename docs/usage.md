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
