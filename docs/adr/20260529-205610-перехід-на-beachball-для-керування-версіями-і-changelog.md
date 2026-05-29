---
session: 9b851872-974e-4842-96a2-14ae3cf1a806
captured: 2026-05-29T20:56:10+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/9b851872-974e-4842-96a2-14ae3cf1a806.jsonl
---

## ADR Перехід на Beachball для керування версіями і CHANGELOG

## Context and Problem Statement

У bun-монорепо `nitra/cursor` кожен розробник вручну виконував `version bump` і дописував `CHANGELOG.md` у feature-гілці. При паралельній роботі двох розробників це гарантувало git-конфлікт у `package.json` (`version`) і в `CHANGELOG.md` (верхня секція), оскільки обидва редагували одні й ті самі рядки від однієї бази.

## Considered Options

* Зберегти ручний підхід із `merge=union` для `CHANGELOG.md` у `.gitattributes` (Рівень 1 — швидкий фікс)
* Перейти на `@changesets/cli` з власним форматом файлів `.changes/*.md` (Рівень 3 — повна інтеграція у `n-cursor`)
* Перейти на **Beachball** із стандартним форматом `CHANGELOG.md` і CI auto-release на merge в `main`
* Гібридний підхід: власний формат чейнджсетів з кастомним рендерером для збереження українського CHANGELOG-формату

## Decision Outcome

Chosen option: "Beachball із CI auto-release на merge", because Beachball є усталеним інструментом для JS/npm-монорепо, добре інтегрується з наявним `npm-publish.yml`, і переносить `version bump` із feature-гілок у єдину серіалізовану точку — CI, що прибирає причину конфлікту, а не лише симптом. Стандартний формат CHANGELOG обраний замість кастомного українського рендерера, щоб уникнути зайвої складності на першій ітерації.

### Consequences

* Good, because два розробники з паралельними фічами більше не конфліктують — кожен додає окремий файл у `change/`, а не редагує `package.json` і `CHANGELOG.md`.
* Good, because `version bump` і генерація CHANGELOG переїжджають у CI (`bunx beachball publish`), що усуває клас помилок «забув підняти версію».
* Bad, because `npm-publish.yml` потребує зміни `permissions: contents: write` (зараз `read`) і видалення `JS-DevTools/npm-publish@v3` — ненульовий ризик при міграції.
* Bad, because стандартний Beachball-формат CHANGELOG відрізняється від наявного українського формату, що означає зміну вигляду `npm/CHANGELOG.md` після першого релізу.

## More Information

Файли, що підлягають змінам або створенню:
- `.github/workflows/npm-publish.yml` — `contents: write`, замінити `JS-DevTools/npm-publish@v3` на `bunx beachball publish`
- `.github/workflows/beachball-check.yml` — новий PR gate з `paths: ['npm/**']`
- `beachball.config.js` — новий кореневий конфіг
- `change/.gitkeep` — нова директорія для чейнджсетів
- `.cursor/rules/n-changelog.mdc` — оновити після першого успішного CI-релізу

Spec: `docs/superpowers/specs/2026-05-29-changesets-migration.md`
Plan: `docs/superpowers/plans/2026-05-29-changesets-migration.md`
