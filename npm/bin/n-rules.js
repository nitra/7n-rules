#!/usr/bin/env node

import { isRunAsCli } from '../scripts/cli-entry.mjs'
import { runCli } from './n-rules-cli.mjs'

if (isRunAsCli(import.meta.url)) {
  await runCli(process.argv.slice(2))
}
