# Architecture

`src/bin/ndxserver.ts` sets `NDX_INVOKED_AS_SERVER=1` and imports
`@neurondev/ndx-core/cli`. No server implementation lives in this app.

