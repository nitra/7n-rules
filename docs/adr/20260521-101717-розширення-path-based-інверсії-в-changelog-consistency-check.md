---
session: 9b7a20d9-33b8-411f-a1fe-e89fe833bd53
captured: 2026-05-21T10:17:17+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/9b7a20d9-33b8-411f-a1fe-e89fe833bd53.jsonl
---

## ADR Розширення path-based інверсії в `changelog/consistency/check.mjs`

## Context and Problem Statement

Правило `changelog/fix/consistency` вимагало version-bump і запису в `CHANGELOG.md` при будь-яких змінах у workspace — включно з синхронізацією канонічних правил (`.cursor/rules/`), хуків (`.claude/hooks/`), скілів та конфігів `AGENTS.md`/`CLAUDE.md`. Такі «tooling-зміни» засмічували CHANGELOG записами, що не впливають на логіку/поведінку проєкту.

## Considered Options

* **A — Path-based інверсія**: розширити `CHANGELOG_IGNORE_PATH_PREFIXES` у `check.mjs`, додавши `.cursor/` і `.claude/`, та `CHANGELOG_IGNORE_PATH_EXACT` — `AGENTS.md`, `CLAUDE.md`.
* **B — Content-aware перевірка `package.json`**: парсити JSON-diff і ігнорувати bump, якщо торкнуто лише `devDependencies`/ключа `@nitra/cursor`.
* **C — Оновлення тексту `.mdc`**: явно задокументувати виключення tooling-змін у правилі для агента.

## Decision Outcome

Chosen option: "A — Path-based інверсія", because користувач явно обрав лише частину A; B і C відкладено.

### Consequences

* Good, because зміни в `.cursor/`, `.claude/`, `AGENTS.md`, `CLAUDE.md` більше не тригерять обов'язковий version-bump і запис у `CHANGELOG.md` — 30 тестів проходять (`check.test.mjs`).
* Bad, because bump `@nitra/cursor` у `devDependencies` кореневого `package.json` (частина B) досі потрапляє до changelog, якщо root-workspace визначений як релізний; варіант B не реалізовано.

## More Information

- Змінені файли: `npm/rules/changelog/fix/consistency/check.mjs`, `npm/rules/changelog/fix/consistency/check.test.mjs`, `npm/CHANGELOG.md`, `npm/package.json` (версія `1.13.66 → 1.13.67`).
- Константи в `check.mjs`: `CHANGELOG_IGNORE_PATH_PREFIXES` поповнено `.cursor/` і `.claude/`; `CHANGELOG_IGNORE_PATH_EXACT` поповнено `AGENTS.md` і `CLAUDE.md`.
- Перевірка запускається командою `bun ./npm/bin/n-cursor.js check changelog`.
