---
type: layered-translation
source: coverage-fix-skill.md
lang: en
sourceFileCrc: 8ac0f265
authored: false
translated: 2026-07-12
model: omlx/gemma-4-e4b-it-OptiQ-4bit
---

# Cursor Skill `n-coverage-fix`: automatic mutation score improvement

## Essence

This skill automatically improves testing quality by detecting and covering "survived" mutants. It creates a deterministic loop that repeatedly generates and enhances test cases, focusing on untested code paths. The goal is to achieve stabilization of the mutation score, avoiding manual attempts. The process ends when the score cannot be improved further or the set iteration limit is reached.

## Problem

Line coverage lies. A test might "touch" a line without verifying anything—and the metric shows 100%, while a bug slips through. **Mutation testing** provides an honest answer: Stryker makes minor changes to the code (`true → false`, `+ → -`, `=== → !==`) and checks if at least one test **fails**. If the mutant **survives** (`survived`), it means this behavior is not covered by any test.

The manual process of "killing" survived mutants looks like this:

```
Developer: "raise mutation score"
Agent: *runs coverage* *reads 30 survived mutants*
       *opens each file* *writes tests haphazardly* *forgets half*
Developer: "and these 12 are still alive"
Agent: *another blind attempt*
```

Slow, without stopping, without guarantee that the score has changed at all.

## Solution: one autonomous skill

`n-coverage-fix` wraps this in a **deterministic convergence loop**: generate report → read survivors → write tests → verify → remeasure → repeat, until the score stops rising (or 3 iterations).

> **Historical note.** Previously, there were two almost identical skills—`n-coverage-fix` (ran coverage itself) and `n-fix-tests` (started from the prepared `COVERAGE.md`). `n-fix-tests` was a strict subset (~95% duplicate) and has been **removed**; everything useful from it (detecting commands from `package.json#scripts`, starting from a prepared report) has been absorbed by the canonical `n-coverage-fix`. Details are in `docs/adr/260604-2008-merging-n-fix-tests-into-n-coverage-fix-and-removing-duplicate.md`.

### General Diagram

````
/n-coverage-fix
      │
      ▼
┌─────────────────────────────┐
│ Step 0a: preflight          │ ── if not in .worktrees/? → STOP,
│           (worktree)        │    create worktree from branch
└──────────────┬──────────────┘
               ▼
┌─────────────────────────────┐
│ Step 0b: command detection  │ ── from package.json#scripts:
│           coverage / test   │    coverage-command, test-command
└──────────────┬──────────────┘
               ▼
┌─────────────────────────────┐
│ Step 1: COVERAGE.md         │ ── fresh report exists? → use
│         (early-skip / gen)  │    otherwise → coverage-command
└──────────────┬──────────────┘
               ▼
┌─────────────────────────────┐
│ Step 2: read survivors      │ ── ```json under "## Survived Mutants"
│         prevCount = N       │    empty → ✓ stop
└──────────────┬──────────────┘
               ▼
┌─────────────────────────────┐
│ Step 3: Agent per file     │ ── groups by file, appends
│         (write tests)        │    minimal test cases
└──────────────┬──────────────┘
               ▼
┌─────────────────────────────┐
│ Step 4: test-command        │ ── are all tests green?
└──────────────┬──────────────┘    no → return Agent with error
               ▼
┌─────────────────────────────┐
│ Step 5: remeasure coverage │
│         newCount vs prevCount│
└──────────────┬──────────────┘
               ▼
     newCount < prevCount  and  iterations < 3 ?
        ├── yes → back to Step 2
        └── no  → ✓ convergence (stop)
````

## How It Works Step-by-Step

### Step 0a — preflight (worktree-only)

The skill has `meta.json → worktree: true`, so it runs **exclusively** in a separate git-worktree. The first step is checking `git rev-parse --show-toplevel`: if you are **not** under `.worktrees/`—**STOP**, the skill itself creates a worktree from the current branch (`<branch>-coverage-f`) using literal commands (without shell expansion) and installs dependencies (`bun install` + `n_cursor_npx` wrapper with retry on CDN propagation of the just-published version).

**Why a worktree:** Stryker writes `mutation.json` and `incremental.json` in one directory—two parallel runs **will mess up both files**. Isolation + forbidding parallelism ensures one instance at a time.

### Step 0b — command detection (from `package.json#scripts`)

The skill reads the root `package.json` and captures two commands (the first one found):

| Command              | Source                                    | Fallback            |
| -------------------- | ------------------------------------------ | ------------------- |
| **coverage-command** | `scripts["coverage"]` → `bun run coverage` | `n-cursor coverage` |
| **test-command**     | `scripts["test"]` → `bun run test`         | `bun test`          |

Thanks to this, the skill adapts to the project instead of hardcoding tools.

### Step 1 — generate or reuse `COVERAGE.md`

**Early-skip:** if `COVERAGE.md` already exists, is fresh (newer than the last change in source/tests), and has the `## Survived Mutants` section—go straight to Step 2. Otherwise—run the coverage-command, which generates the report.

This makes the skill universal for **both** scenarios: "generate and fix" and "fix based on an already existing report."

### Step 2 — read survivors

`COVERAGE.md` → section `## Survived Mutants` → enclosed ` ```json ` block → JSON array. If the section is missing or the array is empty—**stop** (`✓ No survived mutants — mutation score is complete`). Otherwise, remember `prevCount = array.length` as the baseline for comparison.

The JSON block in the report is placed via `renderMarkdown` from `npm/rules/test/coverage/coverage.mjs`—this is the contract between the coverage rule and the skill.

### Step 3 — Dispatch Agent per file

Mutants are grouped by the `file` field. For each group:

1. **Identify the test file** — always `<dir>/tests/<basename>.test.mjs`. If a co-located test (`.test.js`/`.test.mjs`) is found—it is moved to `tests/` with updated relative imports.
2. **Formulate the prompt** — source file + existing tests + list of mutants (line, column, `original → replacement`, type).
3. **Launch a separate Agent** — it adds **minimal** test cases that catch each mutant, **without touching** existing tests, and runs `bun test <file>` itself.

### Step 4 — Verify all tests

Run the test-command from Step 0b. If anything fails—return the corresponding Agent with the error text for correction.

### Step 5 — Remeasure and decide on the loop

Rerun the coverage-command, calculate `newCount`:

| Condition                                     | Action                              |
| --------------------------------------------- | ----------------------------------- |
| `newCount < prevCount` **and** iterations < 3 | new cycle back to Step 2           |
| `newCount >= prevCount`                       | ✓ **convergence** — stop            |
| iterations == 3                               | ⚠️ limit reached — stop with warning |

## Convergence is Normal, Not a Bug

It is **impossible** to kill some mutants: protected external state, non-deterministic logic, equivalent mutations (behavior does not change), dead code. When `newCount` does not decrease after an iteration—the skill stops, instead of hitting a wall. Stryker `incremental` saves progress between runs, so crash $\neq$ starting from scratch.

## Safeguards

- **Do not run in parallel** — neither in different Bash jobs nor in sub-agents. Stryker writes to a shared directory.
- **Only in a worktree** — `meta.json → worktree: true`, preflight fail-fast.
- **Do not commit automatically** — the decision of when to commit remains with the human.
- **3 iteration limit** — protection against infinite loops on stable mutants.

## Summary

| Component              | Role                                             | Location                                  |
| ---------------------- | ------------------------------------------------ | ---------------------------------------- |
| `n-cursor coverage`    | generates `COVERAGE.md` (Stryker + coverage)       | `npm/rules/test/coverage/coverage.mjs`   |
| `## Survived Mutants`   | report contract: JSON array of survived mutants      | `COVERAGE.md` in the project root        |
| Skill `n-coverage-fix` | autonomous loop "add tests until convergence"       | `.cursor/skills/n-coverage-fix/SKILL.md` |
| Agent (per file)        | writes minimal tests for specific mutants         | dispatched by the skill                  |

`n-coverage-fix` is the point where a deterministic tool (Stryker states **WHAT** is not covered) meets LLM intelligence (the agent decides **HOW** to test it), enclosed in a feedback loop with a fair stopping criterion.
