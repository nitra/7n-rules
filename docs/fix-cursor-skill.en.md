---
type: layered-translation
source: fix-cursor-skill.md
lang: en
sourceFileCrc: 77391571
authored: false
translated: 2026-07-12
model: omlx/gemma-4-e4b-it-OptiQ-4bit
---

# Cursor Skill: How one command brings the project to standards in a minute

## Essence

This document describes the mechanism of the `Cursor Skill n-fix`, which ensures the complete automation of bringing the entire project up to internal standards. It combines quick programmatic diagnostics with the powerful intelligence of an AI agent to resolve violations. Instead of slow manual analysis, the system executes a clear, multi-level workflow: tools find problems, the LLM agent fixes them, and subsequent verification guarantees compliance with conventions. This allows for achieving full project consistency in minimal time.

## Problem

You have a set of rules for the project: Bun instead of npm, oxfmt instead of Prettier, correct GitHub Actions, cspell with a Ukrainian dictionary, ESLint with a corporate config. The rules are described in `.cursor/rules/*.mdc` — the AI agent sees and follows them when writing code.

But what to do when you need to **bring the entire project up to standards**? For example:

- New rules are added to an existing repository
- Configuration is updated and all files need to be checked/fixed
- A new team member cloned the project and wants to make sure everything is okay

It used to look like this:

```
Developer: "Check if the project complies with rules and fix"
Agent: *reads 10 rules* *makes 40+ tool calls* *misses half*
Developer: "And did it delete yarn.lock? Did it check GitHub Actions?"
Agent: *20 more tool calls*
```

Slow, expensive (thousands of tokens), unreliable.

## Solution: Cursor Skill `n-fix`

The Cursor Skill is a markdown file with instructions for the AI agent that automatically picks up relevant requests. Unlike rules (`.cursor/rules/`), the skill describes not conventions, but a **specific workflow** — a sequence of actions.

### How it works

```
Developer: "n-fix" (or "fix project", "apply rules")
                │
                ▼
        Cursor sees the Skill
        n-fix/SKILL.md
                │
                ▼
    ┌───────────────────────┐
    │ 1. npx @nitra/cursor  │ ── 1 tool call, 100ms
    │    fix                │    instead of 40+ tool calls
    │                       │
    │    ✅ No yarn.lock │
    │    ❌ No .oxfmtrc  │
    │    ❌ ESLint config   │
    │    ✅ bun.lock exists │
    └───────────┬───────────┘
                │
                ▼
    ┌───────────────────────┐
    │ 2. Analysis ❌          │ ── The agent knows WHAT is broken
    │    .oxfmtrc.json      │    + has rules on HOW to fix it
    │    eslint.config.js   │    (from .cursor/rules/*.mdc)
    └───────────┬───────────┘
                │
                ▼
    ┌───────────────────────┐
    │ 3. Fixing        │ ── The agent creates/updates files
    │    Created .oxfmtrc   │    using LLM intelligence
    │    Created eslint.cfg │    for complex cases
    │    Updated package.json│
    └───────────┬───────────┘
                │
                ▼
    ┌───────────────────────┐
    │ 4. bun i              │ ── Installing dependencies
    └───────────┬───────────┘
                │
                ▼
    ┌───────────────────────┐
    │ 5. oxfmt .            │ ── Formatting
    └───────────┬───────────┘
                │
                ▼
    ┌───────────────────────┐
    │ 6. bun run lint-*     │ ── All linters from package.json
    └───────────┬───────────┘
                │
                ▼
    ┌───────────────────────┐
    │ 7. npx @nitra/cursor  │ ── Verification
    │    fix                │
    │                       │
    │    ✅ No yarn.lock │
    │    ✅ .oxfmtrc.json   │
    │    ✅ ESLint config   │
    │    ✅ bun.lock exists │
    └───────────────────────┘
```

### Key Idea: Programmatic Diagnostics + LLM Intelligence

The Skill combines two approaches:

| Stage         | Method                       | Why                                               |
| ------------ | --------------------------- | -------------------------------------------------- |
| Diagnostics  | `rules/<id>/fix.mjs` rules | Deterministic, fast, 1 tool call                 |
| Fixing        | LLM Agent                   | Flexible, understands context, handles complex cases |
| Formatting    | `oxfmt`                     | Deterministic, consistent result                 |
| Linting       | `lint-*` scripts            | Automatic fixing with `--fix`                  |
| Verification  | `rules/<id>/fix.mjs` rules | Confirmation of the result                           |

Programmatic scripts tell the agent **WHAT** is broken. MDC rules say **HOW** to fix it. The agent connects this and acts.

## Anatomy of the Skill File

```
.cursor/skills/n-fix/
└── SKILL.md
```

```yaml
---
name: n-fix
description: >-
  Fix project to comply with all n cursor rules. Use when the user asks
  to fix the project, apply rules, make project compliant, or mentions
  n-fix.
---
```

**Frontmatter:**

- `name` — identifier, up to 64 characters
- `description` — when Cursor should activate this skill. Written in the third person, with trigger terms

**Body:** a step-by-step workflow with the commands the agent executes sequentially.

### Full Workflow

```markdown
1. Diagnostics → npx @nitra/cursor fix
2. Analysis → find ❌, determine rules
3. Fixing → create/update files according to MDC
4. Installation → bun i
5. Formatting → oxfmt .
6. Linters → bun run lint-* (all from package.json)
7. Verification → npx @nitra/cursor fix
8. Repeat → if ❌ remain → step 3
```

## Comparison with Alternatives

### Option 1: Programmatic fix scripts

```javascript
// fix-bun.mjs — script that deletes files itself, updates JSON
/**
 *
 */
export async function fix() {
  if (existsSync('yarn.lock')) unlinkSync('yarn.lock')
  // ...
}
```

**Cons:**

- You need to write and maintain a separate script for each rule
- Logic duplication (rule + script describe the same thing)
- The script cannot handle complex cases (code refactoring, contextual changes)
- Fragility — changing a rule requires updating the script

### Option 2: LLM without diagnostics

```
Agent: *reads 10 rules* *manually checks files* *fixes*
```

**Cons:**

- 40+ tool calls just for diagnostics
- Thousands of tokens for reasoning
- May miss violations
- Slow (minutes instead of seconds)

### Option 3: Skill + `fix` command (our approach)

```
1 tool call (fix) → agent sees list of problems → fixes → 1 tool call (verify)
```

**Pros:**

- Diagnostics in 100ms instead of minutes
- LLM focuses on fixes, not finding problems
- Complex cases are handled by LLM intelligence
- No duplication — rules in MDC, checks in scripts, fixing in LLM
- Feedback loop — re-checking guarantees the result

## Automatic Distribution

The Skill is distributed along with the `@nitra/cursor` package:

```
npm/@nitra/cursor/
├── rules/            ← rules (<id>/<id>.mdc + js/<concern>/check.mjs + policy/)
├── scripts/          ← shared utils (run-standard-rule, run-conftest-batch, …)
├── skills/           ← Cursor Skills (in package — <id>/; after sync in project — .cursor/skills/n-<id>/)
│   └── fix/
│       └── SKILL.md
└── AGENTS.template.md
```

Upon running `npx @nitra/cursor` CLI, it automatically:

1. Loads MDC rules to `.cursor/rules/`
2. Copies skills to `.cursor/skills/`
3. Generates `AGENTS.md` with links to rules and skills

For other AI agents (Claude Code, Codex), the link to the skill is added to `AGENTS.md`:

```markdown
## Skills

- `.cursor/skills/n-fix/SKILL.md` — automatic project fixing
```

The agent reads `AGENTS.md` → sees the skill → opens `SKILL.md` → executes the workflow.

## How to add your Skill

### 1. Create the directory

```bash
mkdir -p .cursor/skills/your-skill-name
```

### 2. Write SKILL.md

```markdown
---
name: your-skill-name
description: >-
  What it does. Use when the user asks to...
---

# Your Skill

## Workflow

1. **Step** — description
2. **Step** — description
```

### 3. Principles of an effective Skill

- **Specific commands** — the agent must know exactly what to run
- **Feedback loop** — checking after fixes is mandatory
- **Programmatic diagnostics** — where possible, replace manual checks with scripts
- **Do not duplicate rules** — the skill says WHAT to do, MDC says HOW
- **Up to 500 lines** — SKILL.md should be concise

## Summary

| Component        | Role                                   | Where it lives                  |
| ---------------- | -------------------------------------- | ------------------------ |
| MDC Rules        | Conventions for LLM: how to write code       | `.cursor/rules/`         |
| `fix.mjs` Rules | Programmatic diagnostics: what is broken      | `npm/rules/<id>/fix.mjs` |
| Skill            | Agent workflow: sequence of actions | `.cursor/skills/`        |
| AGENTS.md        | Entry point for all agents           | project root           |

Skill `n-fix` is the point where programmatic verification meets LLM intelligence. Scripts quickly find problems, the agent intelligently solves them, and then scripts confirm the result. One workflow, one command, full compliance with standards.
