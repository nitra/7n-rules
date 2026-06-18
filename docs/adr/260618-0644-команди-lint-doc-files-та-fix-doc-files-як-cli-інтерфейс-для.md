---
session: 4a973ee4-4770-4098-9a7b-d85ff04df9ef
captured: 2026-06-18T06:44:33+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/4a973ee4-4770-4098-9a7b-d85ff04df9ef.jsonl
---

Так, є дві CLI-команди для файлової документації:

```bash
# Перевірити, які файли мають застарілу/відсутню доку
npx @nitra/cursor lint-doc-files

# Згенерувати / оновити файлові доки (JS-оркестрований, local LLM через omlx)
npx @nitra/cursor fix-doc-files
```

**Прапори `lint-doc-files`:**
- `--json` — машиночитний вивід (exit 0)
- `--missing-only` — тільки відсутні
- `--hook` / `--git` — hook-протокол (exit 2 при дрейфі)
- `--degraded` — м'який режим

**Прапори `fix-doc-files`:**
- `--limit N` — обробити лише N файлів
- `--from <path>` — починати з конкретного файлу
- `--overwrite` — перегенерувати навіть актуальні
- `--stamp` — тільки перештампувати CRC без виклику LLM

Ці команди є новішим аналогом `docgen scan/modules` — вони роблять повний цикл (lint → fix) без потреби запускати Claude-агента вручну.

---

## ADR Команди `lint-doc-files` та `fix-doc-files` як CLI-інтерфейс для файлової документації

## Context and Problem Statement
Користувач запитав, чи є команда `npx @nitra/cursor doc-files` або аналог для генерації документації. Виявилось, що CLI `@nitra/cursor` має дві спеціалізовані підкоманди — `lint-doc-files` і `fix-doc-files` — які разом утворюють детермінований цикл перевірки та генерації файлових `.md`-документів поряд із вихідним кодом.

## Considered Options
* `npx @nitra/cursor lint-doc-files` + `fix-doc-files` (детермінований lint → fix цикл)
* `npx @nitra/cursor docgen scan|modules` + ручний диспатч Claude-субагентів (skill `/n-docgen`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`lint-doc-files` / `fix-doc-files` як основний CLI-інтерфейс", because CLI реалізує повний цикл автономно через JS-оркестрацію з локальним LLM (omlx), без потреби запускати Claude-агента; `docgen scan/modules` — допоміжні сканери для skill-flow.

### Consequences
* Good, because `fix-doc-files` не вимагає Claude-агента — генерація відбувається локально через omlx, підтримує `--limit`/`--from`/`--overwrite`/`--stamp`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Реалізація: `npm/bin/n-cursor.js` → `case 'lint-doc-files'` / `case 'fix-doc-files'`
- Lint-модуль: `npm/rules/doc-files/lint/lint.mjs` (`runLintDocFilesCli`)
- Gen-модуль: `npm/rules/doc-files/js/docgen-files-batch.mjs` (`runDocFilesGenCli`, `runDocFilesStampCli`)
- Hook-протокол: `--hook` (PostToolUse, exit 2 при дрейфі), `--git` (Stop-hook, блокує завершення задачі)
- Поріг gate: `N_CURSOR_DOC_FILES_GATE_MAX` (дефолт 50)
