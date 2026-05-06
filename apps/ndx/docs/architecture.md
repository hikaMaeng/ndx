# Architecture

`src/bin/ndx.ts` calls `@neurondev/ndx-core/cli` `main()`.
`src/bin/ndxserver.ts` sets `NDX_INVOKED_AS_SERVER=1` and calls the same core
entrypoint. No domain logic belongs in this app.

