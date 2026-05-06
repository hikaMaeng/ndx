#!/usr/bin/env node
import { loadCoreCli } from "./core-loader.js";

const { main } = await loadCoreCli();
await main();
