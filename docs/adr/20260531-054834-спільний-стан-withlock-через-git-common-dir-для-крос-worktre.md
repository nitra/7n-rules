---
session: 09dcb1bc-929b-4d88-90b0-c0611bed3d2f
captured: 2026-05-31T05:48:34+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/09dcb1bc-929b-4d88-90b0-c0611bed3d2f.jsonl
---

[tool: Bash] {"command":"cd /Users/vitaliytv/www/nitra/cursor && git log --oneline -5","description":"Check git log after commits"}
[user]
[tool_result] b770c12 feat: auto.md — YAML frontmatter з полем worktree, копіюється до .cursor/skills/
e58a0ea feat: withLock крос-worктree серіалізація через resolveLockCacheDir (git-common-dir)
4acce16 docs: план імплементації skill auto.md frontmatter + worktree field
fbe0e6e docs: spec — skill auto.md frontmatter + worktree field design
6f81a15 feat: withLock крос-worktree серіалізація + test rule v2.7

All done. Summary:

**withLock (крос-worktree серіалізація) — `e58a0ea`:**
- Новий `npm/scripts/utils/lock-cache-dir.mjs` — `resolveLockCacheDir(key)` повертає шлях під `<git-common-dir>/n-cursor/<key>`, спільний для всіх worktree
- `with-lock.mjs` — `cacheDir` тепер за замовчуванням від `resolveLockCacheDir`, не від `node_modules/.cache`
- `scripts.mdc` оновлено
- 16/16 тестів зелені

**auto.md frontmatter + worktree field — `b770c12`:**
- 9 `npm/skills/*/auto.md` мігровано на YAML frontmatter з полями `auto:` і `worktree:`
- `auto-skills.mjs` — `parseSkillAutoSpec` тепер парсить frontmatter, повертає `{ always, rules, worktree }`
- `n-cursor.js` `syncSkills` — прибрано `if (file === 'auto.md') continue`; тепер `auto.md` копіюється в `.cursor/skills/n-<id>/`
- Тести виправлено (додано імпорти, оновлено fixtures), 16/16 зелені

---

Це кінець транскрипту.

---

## ADR: Спільний стан `withLock` через `git-common-dir` для крос-worktree серіалізації

## Context and Problem Statement

`withLock` зберігав стан локу в `node_modules/.cache/n-cursor/<key>/`, але кожен git-worktree має свій `node_modules` — тому локи між worktree не серіалізувалися. Кілька важких команд (`lint`, `fix`, Stryker) могли запускатися паралельно у різних worktree всупереч заявленому захисту.

## Considered Options

* Перенести `cacheDir` на `git-common-dir` (один на головний checkout і всі linked-worktree)
* «Мітка в назві worktree» — перевіряти існування worktree з назвою-міткою скіла

## Decision Outcome

Chosen option: "Перенести `cacheDir` на `git-common-dir`", because git-common-dir однаковий для всіх worktree, зберігає PID-liveness і fingerprint-dedup без змін логіки, а мітка-в-назві не вирішує TOCTOU-гонку й не покриває ручні виклики поза worktree.

### Consequences

* Good, because transcript фіксує очікувану користь: `lint`, `fix`, Stryker, запущені в різних worktree, серіалізуються через один `mkdirSync`-mutex у `.git` головного репо.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- `npm/scripts/utils/lock-cache-dir.mjs` — `resolveLockCacheDir(key)`: `git rev-parse --git-common-dir` → `<common-dir>/n-cursor/<key>`; fallback на `node_modules/.cache/n-cursor/<key>` поза git.
- `npm/scripts/utils/with-lock.mjs:66` — `cacheDir = opts.cacheDir ?? resolveLockCacheDir(key)`.
- `npm/scripts/utils/tests/lock-cache-dir.test.mjs` — 5 тестів: відносний/абсолютний `git-common-dir`, крос-worktree однаковість, два fallback-сценарії.
- `npm/.changes/1780162853358-7a418d.md` — change-файл `bump: minor`.

---

## ADR: `auto.md` скілів — YAML frontmatter з полем `worktree`

## Context and Problem Statement

Кожен скіл у `npm/skills/<id>/auto.md` зберігав лише умову автоактивації одним рядком plain text. Поле, що визначає бажаність worktree-ізоляції, ніде не було закодовано. Крім того, `auto.md` не копіювався до `.cursor/skills/n-<id>/` під час синку — агент у проєкті не міг прочитати метадані скіла безпосередньо.

## Considered Options

* YAML frontmatter в `auto.md`, файл копіюється до `.cursor/skills/n-<id>/` (обраний)
* Додати `worktree` у frontmatter `SKILL.md` під час синку
* Зберігати `worktree` лише в пакеті (не копіювати до проєкту)

## Decision Outcome

Chosen option: "YAML frontmatter в `auto.md`, файл копіюється до `.cursor/skills/n-<id>/`", because агент у проєкті потребує доступу до worktree-підказки під час виконання скіла, а окремий файл поруч із `SKILL.md` не змінює структуру самого скіла і зберігає авто-активаційну логіку в тому ж місці.

### Consequences

* Good, because transcript фіксує очікувану користь: скіл може сам прочитати `auto.md` і отримати `worktree: true/false` без зовнішнього механізму; `parseSkillAutoSpec` тепер повертає `{ always, rules, worktree }`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Формат: `---\nauto: завжди\nworktree: true\n---` (YAML frontmatter, без body).
- Поле `worktree` — advisory (`false` за замовчуванням); скіл сам вирішує, коли читати.
- `npm/bin/n-cursor.js` `syncSkills` — видалено рядок `if (file === 'auto.md') continue`.
- `npm/scripts/auto-skills.mjs` `parseSkillAutoSpec` — парсить frontmatter через regex `^---\n([\s\S]*?)\n---`, зворотньо сумісний із plain-text.
- `npm/.changes/1780166074688-f2ffef.md` — change-файл `bump: minor`.
- Значення `worktree` по скілах: `fix`, `lint`, `fix-tests`, `coverage-fix`, `taze` → `true`; решта → `false`.
