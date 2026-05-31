---
session: 09dcb1bc-929b-4d88-90b0-c0611bed3d2f
captured: 2026-05-31T05:41:50+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/09dcb1bc-929b-4d88-90b0-c0611bed3d2f.jsonl
---

Зрозумів — C1 (`worktree: boolean`) і якщо `true`, лок implicit забороняє паралельність (що вже є через `withLock`). Маю достатньо для дизайну.

## Пропозиція дизайну

### 1. Нова схема `meta.json` (один файл замість `auto.md`)

```json
{
"auto": "завжди",
"worktree": true
}
```

Поле `auto` — точно той самий зміст, що в `auto.md` (рядок `"завжди"`, `"[bun]"` і т.д.). Поле `worktree` — boolean, якщо відсутнє — `false`.

### 2. `syncSkills` (в `bin/n-cursor.js`)

Зараз він пропускає `auto.md` (`if (file === 'auto.md') continue`). Тепер:
- пропускає `meta.json` (не копіює в проєкт)
- після копіювання `SKILL.md` — читає `meta.json`, і якщо `worktree: true`, **вставляє** `worktree: true` у YAML-frontmatter скопійованого `.cursor/skills/n-<id>/SKILL.md`

### 3. `auto-skills.mjs`

Замінити `readFileSync(<path>/auto.md)` + hand-crafted парсер → `JSON.parse(readFileSync(<path>/meta.json))` → беремо `auto`. Логіка `discoverSkillAutoActivation` не змінюється.

### 4. Усі `npm/skills/<id>/auto.md` видаляються, зʼявляються `meta.json`

9 файлів:

| Скіл | `auto` | `worktree` |
|---|---|---|
| `fix` | `"завжди"` | `true` |
| `lint` | `"завжди"` | `true` |
| `taze` | `"[bun]"` | `true` |
| `coverage-fix` | `"[test]"` | `true` |
| `fix-tests` | `"[test]"` | `true` |
| `adr-normalize` | `"[adr]"` | `true` |
| `start-check` | `"завжди"` | `false` |
| `llm-patch` | `"завжди"` | `false` |
| `publish-telegram` | `"завжди"` | `false` |

### 5. JSON-схема + `check`-правило

Додати `meta.json` до схеми правила `npm-module` (або окремий `check-meta.mjs`).

---

Це виглядає правильно? Чи є уточнення до того, як `worktree: true` вставляється у `SKILL.md` frontmatter?
[user]
все правильно, дій

---

## ADR withLock крос-worktree серіалізація

## Context and Problem Statement
Проєкт запускає кілька AI-агентів паралельно, кожен з яких може самостійно тригерити важкі CLI-команди (`lint-*`, `fix-*`, `check`). Механізм серіалізації `withLock` зберігав стан (lock-директорію + dedup-кеш) у `node_modules/.cache/n-cursor/<key>/`, а `node_modules` у кожного git-worktree свій, тому між worktree лок не діяв і важкі команди запускались паралельно.

## Considered Options
* Мітка в назві git-worktree — перевіряти, чи worktree з відповідним іменем вже існує.
* Розширити `withLock`, перевівши `cacheDir` на спільний (git-common-dir) шлях.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Розширити `withLock`, перевівши `cacheDir` на спільний (git-common-dir) шлях", because мітка в назві має TOCTOU-гонку, stale-block після краша, не покриває прямий виклик `bun run lint` поза скілом — всі ці дефекти були явно зазначені в transcript. Канонічний lock через `mkdirSync` на спільному шляху вирішує всі три.

### Consequences
* Good, because transcript фіксує очікувану користь: `mkdirSync`-mutex стає крос-worktree, PID-liveness + max-age залишаються, dedup per-fingerprint не дедуплює різні гілки помилково.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Нові файли: `npm/scripts/utils/lock-cache-dir.mjs` (експортує `resolveLockCacheDir`), `npm/scripts/utils/tests/lock-cache-dir.test.mjs`. Змінено: `npm/scripts/utils/with-lock.mjs` — рядок `cacheDir = opts.cacheDir ?? resolveLockCacheDir(key)`. Стан локу — `<git rev-parse --git-common-dir>/n-cursor/<key>`. Fallback поза git-репо — `node_modules/.cache/n-cursor/<key>`. Change-файл: `npm/.changes/1780162853358-7a418d.md`.

---

## ADR meta.json замість auto.md у скілах

## Context and Problem Statement
Скіли в `npm/skills/<id>/` мали `auto.md` — плоский текстовий файл з умовою автоактивації (`завжди` / `[rule,...]`). З появою потреби додати ще одне налаштування (запускати скіл у git-worktree чи ні) плоский текст не масштабується, а новий `auto.md`-like файл дублював би паттерн.

## Considered Options
* Додати другий окремий файл (наприклад `worktree.md`) поруч з `auto.md`.
* Замінити `auto.md` на `meta.json` з усіма налаштуваннями скіла.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Замінити `auto.md` на `meta.json` з усіма налаштуваннями скіла", because JSON легко валідувати JSON-схемою (практика вже є в репо: `.n-cursor.json`, `schemas/`), парсер однозначний, і всі налаштування в одному місці.

### Consequences
* Good, because transcript фіксує очікувану користь: структурована схема, легка валідація `check`-правилом, поле `worktree: boolean` вшивається в `SKILL.md` frontmatter під час `syncSkills` — агент бачить налаштування без зайвих файлів у проєкті.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Структура `meta.json`: `{ "auto": "завжди" | "[rule,...]", "worktree": true | false }`. Якщо `worktree: true` — `syncSkills` (в `bin/n-cursor.js`) вставляє `worktree: true` у YAML-frontmatter `.cursor/skills/n-<id>/SKILL.md`. Файл `meta.json` не копіюється в проєкт (так само як `auto.md` зараз). `auto-skills.mjs` перемикається з `readFileSync(auto.md)` + hand-crafted парсер на `JSON.parse(readFileSync(meta.json))`. Усі 9 `auto.md` під `npm/skills/` видаляються.
