---
type: JS Module
title: skills-cli.mjs
resource: npm/scripts/skills-cli.mjs
docgen:
  crc: 9b3e0ad4
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 25
  issues: no-overview,short-behavior,internal-name:runTazeOrchestratorCli,anchor-miss:tsconfig.json,anchor-miss:.n-rules.json,anchor-miss:.n-cursor.json,anchor-miss:main.json,best-of-2:retry-lost
---

## Публічний API

- resolveBundledPackageRoot — Корінь пакета `@7n/rules` (каталог з `skills/`, `rules/`, …).
- isTazeOrchestratorSkillArgs — Чи `argv` (аргументи після `skill`) резолвиться в JS-оркестрований
worktree-only `taze`-шлях (`runTazeOrchestratorCli`) — той самий критерій,
що й нижче в `runSkillsCli`. Використовується `n-rules.js`, щоб не мутувати
root `package.json` (self-upgrade `@7n/rules`) ДО власного worktree-гейту
оркестратора: той сам створює worktree і перевіряє чистоту дерева
(`ensureRunningInWorktree`, `requireCleanTree: true`) — мутація package.json
прямо перед цим викликом примусово провалила б auto-create там, де дерево
інакше було б чисте.
- isJsOrchestratedSkillArgs — Чи аргументи ведуть у будь-який JS-оркестрований skill. Потрібно верхньому
CLI, щоб не мутувати root package.json self-upgrade-ом до власного preflight
оркестратора.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
