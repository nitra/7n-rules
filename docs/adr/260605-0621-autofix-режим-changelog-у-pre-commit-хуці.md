---
session: 07733932-6418-491f-a9b3-8f94fb6836d9
captured: 2026-06-05T06:21:16+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/07733932-6418-491f-a9b3-8f94fb6836d9.jsonl
---

<memory context>
</memory context>
[assistant]
[thinking]

Let me analyze this transcript to produce MADR-style decision documentation.

The session contains several design decisions:

1. **Autofix mode in pre-commit hook for changelog**: The main decision - instead of failing when no change-file exists, the hook should auto-create it.

2. **Skipping `npm view` (network call) in autofix mode**: The user asked to remove the `npm view` call from the hook entirely in autofix mode.

3. **Auto-generated message source**: Agreed to use the last commit's subject as the message for the auto-created change file.

These are 2-3 distinct design decisions worth capturing as separate ADRs.
</thinking>

## ADR Autofix-режим changelog у pre-commit хуці

## Context and Problem Statement
Pre-commit хук `npm-changelog` (hk.pkl) викликав `check changelog`, який падав із помилкою, якщо воркспейс мав релевантні зміни, але не мав change-файлу в `.changes/`. Кожен такий коміт вимагав ручного `npx @nitra/cursor change ...` перед повторним спробою.

## Considered Options
* Блокувати коміт і вимагати від користувача вручну класти change-файл (стара поведінка)
* Autofix-режим: хук сам створює change-файл із дефолтами і не фейлиться

## Decision Outcome
Chosen option: "Autofix-режим", because користувач явно визначив: хук повинен сам створювати change-файл замість блокування.

### Consequences
* Good, because transcript фіксує очікувану користь: pre-commit проходить без ручного втручання, exit 0 підтверджено при наживому прогоні.
* Bad, because автогенерований `message` = subject попереднього коміту, а не поточного (поточного ще не існує під час pre-commit); описи можуть бути неточними та потребують ручного редагування перед push.

## More Information
- Гейт: `opts.autofix` або env `N_CURSOR_CHANGELOG_AUTOFIX=1`; поза хуком (CI, ручний `fix`/`check`) режим вимкнено.
- Дефолти: `bump=patch`, `section=Changed`, `message` = `git log -1 --format=%s` HEAD (fallback: назва гілки → літерал `оновлення`).
- Змінено `hk.pkl`: крок `npm-changelog` переведено з `check` на `fix = "N_CURSOR_CHANGELOG_AUTOFIX=1 bun ./npm/bin/n-cursor.js fix changelog"`.
- Реалізація: `npm/rules/changelog/js/consistency.mjs` — функції `resolveAutoChangeMessage`, `reportOrFixMissingChangeFile`.
- 49/49 тестів, lint чистий.

---

## ADR Виключення `npm view` з pre-commit перевірки changelog

## Context and Problem Statement
В autofix-режимі (pre-commit хук) правило `checkPublishedWorkspace` виконувало `npm view` (мережевий запит до реєстру) для отримання опублікованої версії пакета `@nitra/cursor`, навіть якщо мета хука — лише переконатися в наявності change-файлу.

## Considered Options
* Залишити `npm view` для виявлення ручного drift-бампу навіть у хуці
* У autofix-режимі пропускати `npm view` і всю drift-перевірку версій повністю

## Decision Outcome
Chosen option: "У autofix-режимі пропускати `npm view`", because користувач явно вказав: «взагалі прибери npm view з хуку».

### Consequences
* Good, because transcript фіксує очікувану користь: прогін займає 0.43s (у т.ч. без мережі); повідомлення `autofix-режим, реєстрову перевірку version пропущено (без npm view)` підтверджено.
* Bad, because у pre-commit хуці ручний drift-бамп `version` у `package.json` більше не виявляється; catching drift перекладається повністю на CI та ручний `fix changelog` без env.

## More Information
- Реалізовано в `checkPublishedWorkspace` (`npm/rules/changelog/js/consistency.mjs`): якщо `autofix === true`, блок `resolvePublishedVersion` / version-drift пропускається, перехід одразу до перевірки `.changes/` і git-diff.
- Новий тест: `getPublishedVersion`-мок не викликається при `autofix: true` (49/49 pass).
- Документацію оновлено в `npm/rules/changelog/js/docs/consistency.md` і `npm/rules/changelog/changelog.mdc` (version 3.3).
