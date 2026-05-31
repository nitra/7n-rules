---
session: 09dcb1bc-929b-4d88-90b0-c0611bed3d2f
captured: 2026-05-31T06:06:12+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/09dcb1bc-929b-4d88-90b0-c0611bed3d2f.jsonl
---

## ADR Крос-worktree серіалізація `withLock` через `resolveLockCacheDir`

## Context and Problem Statement

`withLock` зберігав стан локу в `node_modules/.cache/n-cursor/<key>/`. Оскільки кожен git-worktree має власний `node_modules`, два виклики важкої команди в різних worktree не бачили блокування одне одного — серіалізація CPU-важких команд (eslint, Stryker) між worktree не працювала.

## Considered Options

* Мітка в назві worktree як індикатор зайнятості
* Перенос стану локу в git-common-dir через новий `resolveLockCacheDir`

## Decision Outcome

Chosen option: "Перенос стану локу в git-common-dir через `resolveLockCacheDir`", because мітка в назві worktree має stale-block, TOCTOU-гонку і не покриває запуски поза worktree, тоді як `git rev-parse --git-common-dir` дає один каталог, спільний для головного checkout і всіх linked-worktree, зберігаючи наявний PID-liveness + fingerprint-dedup механізм `withLock`.

### Consequences

* Good, because transcript фіксує очікувану користь: `mkdirSync`-mutex тепер єдиний на машину незалежно від кількості worktree; `opts.cacheDir` override лишається для тестів і поза-git середовищ (fallback на `node_modules/.cache`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Нові файли: `npm/scripts/utils/lock-cache-dir.mjs` (функція `resolveLockCacheDir`), `npm/scripts/utils/tests/lock-cache-dir.test.mjs` (16 тестів). Змінено: `npm/scripts/utils/with-lock.mjs` (рядок ~66: `opts.cacheDir ?? resolveLockCacheDir(key)`). Changeset: `npm/.changes/1780162853358-7a418d.md` (bump: minor). Тести `scripts/utils/` — 56/56 зелені. Крос-worktree dеdup залишається безпечним: fingerprint включає `git diff HEAD` + untracked, тож два worktree на різних гілках не дедуплять прогони одне одного.

---

## ADR Заміна `skills/*/auto.md` на структурований `meta.json` + поле `worktree`

## Context and Problem Statement

Кожен скіл мав плоский файл `auto.md` з умовою автоактивації (рядок `завжди` або `[rule,...]`). З появою вимоги вказувати, чи скіл виконується в окремому git-worktree, одного рядка в `auto.md` недостатньо — формат не структурований і не валідований JSON-схемою.

## Considered Options

* `meta.json` (структурований JSON, валідація схемою)
* `meta.yaml` / `skill.yaml` (YAML-frontmatter стиль)
* `meta.md` з YAML frontmatter

## Decision Outcome

Chosen option: "`meta.json`", because `auto-skills.mjs` — суто програмний парсер; JSON-схеми вже практикуються в репо (`npm/schemas/`, `.n-cursor.json`); `check`-правило легко валідуватиме обидва поля (`auto` і `worktree`) за схемою.

### Consequences

* Good, because transcript фіксує очікувану користь: одне структуроване джерело правди на скіл замість двох окремих механізмів; `worktree:true` автоматично несе заборону паралельного запуску; D2-sync вшиває людиночитану інструкцію в копію `SKILL.md` через ідемпотентні маркери `<!-- n-cursor:worktree:start/end -->`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Поле `worktree`: булеве, обовʼязкове. `true` = виконувати в окремому git-worktree + заборона паралельного запуску (один інстанс за раз, поверх наявного `withLock`). Принцип вибору значення: `true` — генеративні скіли (fix, taze, coverage-fix, fix-tests, adr-normalize); `false` — реактивні (lint — працює на незакомічених змінах поточного checkout) і read-only (llm-patch, publish-telegram, start-check). `auto.md` у кожному скілі видаляється. `meta.json` при synci не копіюється в `.cursor/skills/`; worktree-інструкція вшивається в `SKILL.md` (D2). Scope Spec A: тільки `npm/skills/` (9 скілів); міграція rules на data-driven `meta.json` (G1, включно з реєстром предикатів для незводимих умов) — Spec B. Spec-файл: `docs/superpowers/specs/2026-05-31-skill-meta-json-worktree-design.md`.
