#!/usr/bin/env node
process.env.NDX_INVOKED_AS_SERVER = "1";
await import("./main.js");
