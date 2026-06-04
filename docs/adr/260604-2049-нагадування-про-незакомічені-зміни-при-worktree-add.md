---
session: 889efce9-844a-483c-84fa-b12a55f91b76
captured: 2026-06-04T20:49:32+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/889efce9-844a-483c-84fa-b12a55f91b76.jsonl
---

## ADR Нагадування про незакомічені зміни при `worktree add`

## Context and Problem Statement

`git worktree add` завжди створює checkout від HEAD — незакомічені зміни основного дерева в новий worktree не потрапляють. Worktree-only-скіли (`n-fix` тощо) перевіряють саме цей стан, тож незакомічені правки лишаються в «сліпій зоні» без жодного попередження. Виявлено на прикладі `.github/workflows/npm-publish.yml`: файл був зламаний локально, але `n-fix` повернув 19/19 ✅ бо бачив лише закомічену версію.

## Considered Options

* Копіювати незакомічені зміни в новий worktree за замовчуванням
* Opt-in флаг `--carry-dirty` для `worktree add`
* Виводити текстове нагадування при `worktree add`, якщо є незакомічені зміни

## Decision Outcome

Chosen option: "Виводити текстове нагадування при `worktree add`", because це найбезпечніший варіант: не порушує семантику ізоляції worktree-скілів, не тягне складного merge-логіки, і дає користувачу достатньо інформації, щоб вручну закомітити потрібні файли перед запуском скіла. Варіант `--carry-dirty` і зміна дефолту були явно відхилені через ризик поламати flow-механіку з `base_commit`.

### Consequences

* Good, because transcript фіксує очікувану користь: користувач бачить перелік (або кількість) незакомічених файлів одразу після `worktree add`, і може закомітити їх перед запуском worktree-скіла.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Реалізація:

- `npm/scripts/lib/worktree.mjs` — `buildDirtyNotice(porcelain, limit = 10)`: чиста функція; при ≤10 файлах виводить перелік, при >10 — лише кількість; чисте дерево → `null`.
- `npm/scripts/worktree-cli.mjs` — `cmdAdd` знімає `git status --porcelain` **до** виклику `git worktree add`, щоб щойно створений checkout `.worktrees/<name>` не потрапляв у сам статус (без цього тест «чисте дерево → без нагадування» падав у ізольованому репо без `.gitignore`).
- Change-файл: `.changes/260604-1950.md` (bump `minor`, секція `Added`).
- `.cursor/rules/n-worktree.mdc` — документує нову поведінку команди `add`.
- Покриття: 29 тестів (unit + інтеграційні), включно з кейсами «брудне дерево → нагадує» та «чисте дерево → мовчить».
