# Testing

Build and bin checks:

```bash
yarn workspace @neurondev/ndx build
node apps/ndx/dist/bin/ndx.js --version
node apps/ndx/dist/bin/ndxserver.js --version
```

Verdaccio release acceptance installs `@neurondev/ndx@<version>` into a clean
npm prefix outside the repository, checks both bins, and runs the generated
project smoke recorded by the active root agenttest suite.
