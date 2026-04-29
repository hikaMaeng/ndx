# Testing

Primary package checks:

```bash
cargo test -p codex-process
```

Run from `codex-rs/`.

Coverage expectations:

- process output capture and exit status
- process cancellation
- serial task ordering
- cancellation hook delivery

No browser verification applies because this package renders no UI.
