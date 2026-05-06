#!/usr/bin/env node
import { loadCoreCli } from "./core-loader.js";

process.env.NDX_INVOKED_AS_SERVER = "1";
const { main } = await loadCoreCli();

await main();
