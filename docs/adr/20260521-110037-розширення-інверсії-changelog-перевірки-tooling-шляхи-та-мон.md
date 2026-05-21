---
session: 9b7a20d9-33b8-411f-a1fe-e89fe833bd53
captured: 2026-05-21T11:00:37+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/9b7a20d9-33b8-411f-a1fe-e89fe833bd53.jsonl
---

## ADR Розширення інверсії changelog-перевірки: tooling-шляхи та монорепо-корінь

## Context and Problem Statement
У проєкті правило `changelog/consistency` вимагало version-bump і запису в `CHANGELOG.md` за будь-які зміни у workspace. Це призводило до того, що синхронізовані з `@nitra/cursor` файли (`.cursor/`, `.claude/`, `AGENTS.md`, `CLAUDE.md`) та ADR-чернетки з кириличними назвами під `docs/` хибно вважалися релізними змінами й тригерили changelog.

## Considered Options
* Розширити path-based інверсію в `check.mjs`: додати `.cursor/`, `.claude/` до `CHANGELOG_IGNORE_PATH_PREFIXES` і окремий `CHANGELOG_IGNORE_PATH_EXACT` для `AGENTS.md`/`CLAUDE.md`
* Content-aware перевірка `package.json` — аналізувати diff по ключах `devDependencies` (Частина B)
* Оновити текст `changelog.mdc` відповідно до коду (Частина C)
* `CHANGELOG_IGNORE_PATH_EXACT` видалити — кореневі файли покриває вже пропуск кореня монорепо

## Decision Outcome
Chosen option: "Path-based інверсія + пропуск кореня монорепо + видалення `CHANGELOG_IGNORE_PATH_EXACT`", because корінь монорепо (`.`) пропускається цілком як glue/конфіг/tooling-workspace, тому окремий `CHANGELOG_IGNORE_PATH_EXACT` для `AGENTS.md`/`CLAUDE.md` стає зайвим; `.cursor/` та `.claude/` ловляться префіксами.

### Consequences
* Good, because transcript фіксує очікувану користь: синхронізовані файли `.cursor/`, `.claude/`, `AGENTS.md`, `CLAUDE.md` та `docs/`-чернетки більше не тригерять вимогу version-bump і запису в `CHANGELOG.md`.
* Good, because корінь монорепо (`.`) пропускається перевіркою — `check changelog` виводить `✅ <root>: корінь монорепо (glue/конфіг/tooling) — перевірку CHANGELOG пропущено; логіка живе в підпакетах`.
* Bad, because в одно-пакетному репозиторії (де корінь = єдиний workspace, не пропускається) bump `@nitra/cursor` у `devDependencies` `package.json` кореня все ще тригерує changelog — content-aware diff `package.json` не реалізовано (Частина B відкладена).

## More Information
- Змінені файли: `npm/rules/changelog/fix/consistency/check.mjs`, `npm/rules/changelog/fix/consistency/check.test.mjs`, `npm/rules/changelog/changelog.mdc`, `npm/CHANGELOG.md`
- Фікс quotePath-багу: `git diff` / `git ls-files` тепер викликаються з `-z` (NUL-розділення), додано хелпер `splitNulPaths` — файли з кириличними іменами більше не повертаються у C-quoted формі `"docs/\320..."` і коректно матчаться з інверсією
- Видалено `CHANGELOG_IGNORE_PATH_EXACT` з коду і тестів; `.mdc` синхронізовано з кодом (версія `2.5 → 2.6`)
- Bump `@nitra/cursor` `1.13.66 → 1.13.67`; 32/32 тести; `bun run lint` — `Issues found: 0`
- Частина B (content-aware `package.json` diff) і синхронізація `.cursor/rules/n-changelog.mdc` (генерується через `npx @nitra/cursor`) — поза scope сесії
