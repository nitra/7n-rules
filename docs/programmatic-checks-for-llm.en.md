---
type: layered-translation
source: programmatic-checks-for-llm.md
lang: en
sourceFileCrc: e593429e
authored: false
translated: 2026-07-12
model: omlx/gemma-4-e4b-it-OptiQ-4bit
---

# Programmatic Verification Instead of LLM Interpretation: How to Reduce Token Costs by 5-8 Times

## Essence

This document proposes a paradigm shift from LLM interpretation of rules to their programmatic verification via CLI scripts. The main guarantee is a significant reduction in token usage and time because, instead of dozens of tool calls for manual file analysis, the agent receives a structured result from a single deterministic call. This allows ensuring full adherence to project conventions without overly burdening the language model.

## The Problem

When an AI agent (Cursor, Copilot, Codex, Claude) works with a project, it must adhere to rules: conventions, configurations, standards. The typical approach is to describe the rules in prompt files (`.cursor/rules/*.mdc`, `AGENTS.md`, `.github/copilot-instructions.md`) and allow the LLM to check compliance itself.

**What happens with LLM verification:**

```
Agent reads the rule: "The project must not contain package-lock.json, yarn.lock..."
    ↓
Agent executes: glob("package-lock.json") → reads result
    ↓
Agent executes: glob("yarn.lock") → reads result
    ↓
Agent executes: glob("pnpm-lock.yaml") → reads result
    ↓
Agent executes: read("package.json") → parses 500+ characters
    ↓
Agent "thinks": "packageManager field is missing, bun.lock exists..."
    ↓
5 tool calls, ~800 reasoning tokens, 30 seconds
```

Each tool call is overhead: tokens for the request, response, and reasoning. And this is for **one** rule. With multiple rules, the agent spends 15-20 tool calls and thousands of tokens on what `node` can do in 100ms.

## Solution: CLI with Deterministic Check Scripts

Instead of the LLM interpreting rules and manually checking files, we create **programmatic scripts** that check everything automatically and return a structured result.

### Architecture

```
.cursor/rules/           npm/scripts/
┌─────────────────┐      ┌──────────────────┐
│ n-bun.mdc       │      │ check-bun.mjs    │
│ (rule for       │      │ (programmatic    │
│  LLM: what to do)│      │  verification)   │
└─────────────────┘      └──────────────────┘
        │                        │
        ▼                        ▼
  LLM reads and                Agent runs:
  understands HOW                 npx @nitra/cursor check bun
  to write code                         │
                                     ▼
                              ✅ No package-lock.json
                              ✅ No yarn.lock
                              ✅ bun.lock exists
                              ❌ packageManager — remove
```

**MDC file** — for the LLM: explains *how* to write code, conventions, examples.
**Check script** — for programmatic verification: checks *if* everything is set up correctly.

`npx @nitra/cursor check` without arguments scans `.cursor/rules/*.mdc` and runs only those checks for which the package has a corresponding check/policy (e.g., `n-bun.mdc` → `check bun`). A clear list in the command line remains possible: `npx @nitra/cursor check bun ga`.

### Example: bun.mdc rule

**MDC file** (what the LLM sees in context) — rules and conventions:

```markdown
The project uses only Bun for dependency management.

Forbidden: npm install, yarn, pnpm
Lockfile: bun.lock
Remove: package-lock.json, yarn.lock, pnpm-lock.yaml, .yarn, .yarnrc.yml
Remove the packageManager field from package.json

## Check

`npx @nitra/cursor check bun`
```

**Check script** (separate file, not in context):

```javascript
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

/**
 *
 */
export async function check() {
  let exitCode = 0
  const pass = msg => console.log(`  ✅ ${msg}`)
  const fail = msg => {
    console.log(`  ❌ ${msg}`)
    exitCode = 1
  }

  const forbidden = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.yarnrc.yml']
  for (const f of forbidden) {
    existsSync(f) ? fail(`Found forbidden file: ${f} — remove it`) : pass(`No ${f}`)
  }

  existsSync('.yarn') ? fail('Found directory .yarn — remove it') : pass('No .yarn/')

  existsSync('bun.lock') ? pass('bun.lock exists') : fail('bun.lock missing — run bun i')

  if (existsSync('package.json')) {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'))
    pkg.packageManager
      ? fail(`packageManager: "${pkg.packageManager}" — remove it`)
      : pass('package.json does not contain packageManager')
  }

  return exitCode
}
```

**Execution Result:**

```
🔍 @nitra/cursor check — rule verification (1)

📋 bun:
  ✅ No package-lock.json
  ✅ No yarn.lock
  ✅ No pnpm-lock.yaml
  ✅ No .yarnrc.yml
  ✅ No .yarn/
  ✅ bun.lock exists
  ✅ package.json does not contain packageManager

✨ Result: 1/1 rules without issues
```

The agent receives this output with **1 tool call** and immediately understands the project's status.

## Comparison with Real Data

Measured on a project with 9 rules (bun, ga, js-lint, text, style-lint, npm-module, js-run, nginx, vue):

### Context (Each message to the agent)

|           | CLI approach                        | Without scripts |
| --------- | --------------------------------- | ------------ |
| MDC files | ~8130 tokens                      | ~8050 tokens |
| Difference   | +80 tokens (lines `## Check`)     | —            |

Overhead is less than 1%. Scripts do not enter the context.

### Verification of all 9 rules

| Metric                | CLI check       | LLM verifies manually         |
| ---------------------- | --------------- | ---------------------------- |
| Tool calls             | **1**           | **15-20**                    |
| Tokens from tool output | **~850**        | **~1400** (files) + overhead |
| Reasoning tokens       | **~100**        | **~2000-3000**               |
| Total                    | **~950 tokens** | **~5000-8000 tokens**        |
| Time                    | **~1 sec**      | **~30-60 sec**               |
| Determinism       | **100%**        | ~80% (LLM might miss)   |

### Verification of one rule (text / oxfmt)

**CLI approach:**

```
1 tool call → 189 tokens → agent immediately sees what to do
```

**LLM manually — must read 4 files:**

```
Read .oxfmtrc.json     → 475 bytes   → check 9 keys
Read extensions.json   → 118 bytes   → find oxc.oxc-vscode
Read settings.json     → 1226 bytes  → check 6 sections formatter
Read package.json      → 517 bytes   → check absence of prettier

4 tool calls → ~584 tokens input → ~500 tokens reasoning
= ~1100 tokens (vs 189 in CLI)
```

## Anti-pattern: Scripts in Prompt Context

The first attempt we made — embedding scripts directly into MDC files:

```markdown
## Scripts

​`javascript title="check-bun.mjs"
import { existsSync } from 'node:fs'
// ... 30 lines of check code ...
process.exitCode = exitCode
​`
```

**Why this is bad:**

- MDC with `alwaysApply: true` is loaded into the context of **every** message
- Scripts added ~520 lines to the total context
- These tokens are consumed even when the agent is just writing code
- Context increase: 966 → 1488 lines (+54%)

**The right approach:** scripts in separate files, only a link to the command in MDC.

## How to Apply This in Your Project

### Step 1: Define the Rule

Describe the rules in `.cursor/rules/` (or `AGENTS.md`) as usual — these are instructions for the LLM.

### Step 2: Create Check Scripts

For every rule that can be verified programmatically, create a script:

```javascript
// scripts/check-<rule-name>.mjs
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

/**
 *
 */
export async function check() {
  let exitCode = 0
  const pass = msg => console.log(`  ✅ ${msg}`)
  const fail = msg => {
    console.log(`  ❌ ${msg}`)
    exitCode = 1
  }

  // Checks using only node:fs, node:path
  // No external dependencies!

  return exitCode
}
```

### Step 3: Add CLI Entry Point

```javascript
// bin/cli.js
const scriptsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts')

const [command, ...args] = process.argv.slice(2)
if (command === 'check') {
  // No arguments — rule names from AGENTS.md (.cursor/rules/….mdc) ∩ existing check-*.mjs
  // With arguments — only specified rules
}
```

### Step 4: Specify the Command in the Rule

```markdown
## Check

`npx @your-package check <rule-name>`
```

## Principles

1. **MDC file = Instruction for LLM** — how to write code, conventions, examples
2. **Check script = Programmatic verification** — whether rules are followed
3. **Scripts are never in context** — only in separate files
4. **Only Node.js built-ins** — scripts run without `npm install`
5. **Structured output** — `✅`/`❌` with clear messages and exit code
6. **One command** — agent runs one tool call instead of dozens

## Where Else to Apply This Pattern

- **Project Structure Verification** — directories, configuration files
- **CI/CD Validation** — presence of workflows, correct triggers
- **Dependency Audit** — forbidden/required packages
- **Configuration Check** — ESLint, prettier, stylelint, cspell
- **Migrations** — checking if old configuration has been replaced by new

Any rule that the LLM checks by reading files is a candidate for a check script.
