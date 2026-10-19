#!/usr/bin/env node
import { runCormiCli } from './cli-runner.js';

try { process.exitCode = await runCormiCli(process.argv.slice(2)); }
finally {
  // The executable owns its optional parent channel; library carriers retain theirs.
  if (process.connected) process.disconnect();
}
