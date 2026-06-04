---
kind: nitra-plan
spec: ../specs/2026-06-02-lint-introduced-classify.md
flow: ../../.worktrees/flow-lint-introduced-classify.flow.json
status: draft
---

# План: js-lint introduced/pre-existing класифікація

## Кроки

1. diff-added-lines.mjs + тести: парс hunks → Map<file,Set<line>>; untracked → всі — acceptance: тести зелені.
2. lint-findings.mjs + тести: parseOxlint/parseEslint/classifyFindings/renderFindings — acceptance: тести зелені.
3. Інтегрувати в lint.mjs quick-шлях (фікс-пас → репорт-пас json → classify → render); full незмінний — acceptance: lint поводиться, блокування A.
4. Change-файл (--ws npm) + тести/oxlint/flow verify — acceptance: bun test зелений; oxlint 0; verify проходить.
