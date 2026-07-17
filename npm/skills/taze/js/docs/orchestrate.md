---
type: JS Module
title: orchestrate.mjs
resource: npm/skills/taze/js/orchestrate.mjs
docgen:
  crc: 37e2a3e9
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл об’єднує публічні дії `buildDependencyPrompt`, `callRunner`, `backupWorkspacePackageFiles`, `cleanupBackups`, `findCargoManifests`, `formatReport`, `runTazeOrchestrator`, щоб узгодити оновлення залежностей за даними з `main.json` і `package.json`. Він працює read-only: не пише у ФС/БД, має кешування в межах прогону, свідомо пропускає шляхи `node_modules`, тимчасово зберігає бекапи `package.json` у воркспейсах і прибирає їх після завершення. Результат проходу оформлюється через `formatReport` як підсумок змін і стану оновлення.

## Поведінка

- **buildDependencyPrompt** — формує текст завдання для перевірки major-оновлення одного пакета й подальшого сумісного рефакторингу.
- **callRunner** — запускає один ітеративний LLM-виклик у вибраному раннері та повертає результат разом із зібраним текстом відповіді.
- **backupWorkspacePackageFiles** — створює тимчасові бекапи `package.json` у воркспейсах для подальшого порівняння змін.
- **cleanupBackups** — прибирає тимчасові бекапи `package.json` після завершення прогону.
- **findCargoManifests** — знаходить `Cargo.toml` поза `node_modules`, `.worktrees` і `target` для інформаційного підсумку.
- **formatReport** — збирає лаконічний Markdown-звіт про minor/patch, major-оновлення, Rust-крейти та загальний обсяг змін.
- **runTazeOrchestrator** — виконує повний прогін taze: перевіряє worktree з `main.json`, робить бекап, оновлює залежності з `package.json`, обробляє major-оновлення по одному пакету, прибирає бекапи й повертає підсумок.

## Публічний API

- buildDependencyPrompt — Готує промпт для одного LLM-кроку taze: тільки breaking changes, сумісність і рефакторинг для одного major-пакета. Перші кроки аналізу та фінальну збірку звіту робить оркестратор без LLM.
- callRunner — Запускає один ітеративний виклик через вибраний раннер. Для `pi` бере текст із stdout вбудованого pi-агента, для `cursor` і `codex` отримує його напряму через ACP-міст.
- backupWorkspacePackageFiles — Зберігає копії `package.json` усіх workspace-пакетів перед змінами, щоб потім відрізнити major і minor оновлення.
- cleanupBackups — Видаляє тимчасові копії `package.json` після завершення роботи.
- findCargoManifests — Находить `Cargo.toml` у репозиторії поза службовими директоріями; використовується лише для огляду Rust-крейтів.
- formatReport — Складає фінальний звіт із результатів усіх ітерацій без окремого LLM-запиту.
- runTazeOrchestrator — Керує taze від початку до кінця: робить бекап, масово оновлює версії, збирає diff, прибирає тимчасові файли й формує звіт. Для кожного major-пакета окремо запускає обмежений LLM-виклик, щоб збій одного пакета не зупиняв інші.

Конфіги: `package.json`, `main.json`

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Кешує результати в межах одного прогону.
- Свідомо пропускає шляхи: `node_modules`.
