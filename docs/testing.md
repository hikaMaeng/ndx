# Testing

## Commands

```bash
npm test
npm run deploy
```

## Coverage

- Fixed global `/home/.ndx/settings.json` path.
- Nearest project `.ndx/settings.json` discovery.
- Global plus project settings merge precedence.
- Global `/home/.ndx/search.json` rule loading.
- Provider/model resolution from settings.
- `keys` and compatibility `env` merge into the shell tool environment.
- Mock model plus shell tool execution.
- Docker build, in-container tests, and in-container mock agent execution.

## Browser Verification

No browser UI exists in the current TypeScript agent. Browser verification is not required for this package.
