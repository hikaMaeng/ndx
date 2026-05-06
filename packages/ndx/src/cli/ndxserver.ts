#!/usr/bin/env node
process.env.NDX_INVOKED_AS_SERVER = "1";
const { main } = await import("./main.js");
await main();
