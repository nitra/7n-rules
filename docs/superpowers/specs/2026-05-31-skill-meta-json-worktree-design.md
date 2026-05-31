# Дизайн: `meta.json` замість `auto.md` + worktree-прапорець у скілах

**Дата:** 2026-05-31
**Статус:** Узгоджено

## Проблема

Скіли в `npm/skills/<id>/` мали `auto.md` — плоский текстовий файл з умовою автоактивації (`завжди` / `[rule,...]`). З появою потреби додати поле `worktree` (чи запускати скіл в ізольованому git-worktree) плоский текст не масштабується.

Паралельно з'ясовано, що скіли з `worktree: true` **не можна запускати кількома інстансами одночасно** — це покривається наявним `withLock` (після патча крос-worktree серіалізації), але агент має отримати чітку інструкцію прямо у `SKILL.md`.

## Рішення

### 1. `meta.json` замість `auto.md`

Кожен `npm/skills/<id>/` отримує `meta.json`:

```json
{
  "auto": "завжди",
  "worktree": false
}
```

або

```json
{
  "auto": ["bun"],
  "worktree": true
}
```

**Поля:**
- `auto` — `"завжди"` (рядок) або масив рядків `["rule1", "rule2"]` (мінімум 1 елемент); відповідає колишньому `auto.md`
- `worktree` — boolean; `true` = скіл виконується в git-worktree, один інстанс за раз

`meta.json` **не копіюється** в проєкт (як `auto.md` зараз).

**Значення по скілах:**

| Скіл | `auto` | `worktree` |
|---|---|---|
| `fix` | `"завжди"` | `true` |
| `lint` | `"завжди"` | `true` |
| `llm-patch` | `"завжди"` | `false` |
| `publish-telegram` | `"завжди"` | `false` |
| `adr-normalize` | `["adr"]` | `true` |
| `taze` | `["bun"]` | `true` |
| `start-check` | `["bun"]` | `false` |
| `coverage-fix` | `["js-lint"]` | `true` |
| `fix-tests` | `["js-lint"]` | `true` |

### 2. Ін'єкція worktree-блоку в `SKILL.md` під час sync (D2)

`syncSkills` (в `bin/n-cursor.js`) читає `meta.json` і якщо `worktree: true` — вставляє/оновлює блок у копії `SKILL.md`:

```markdown
<!-- n-cursor:worktree:start -->
> **Worktree:** цей скіл виконується в окремому `git worktree`.
> Не запускати більше одного інстансу одночасно.
<!-- n-cursor:worktree:end -->
```

**Позиція:** після закриваючого `---` frontmatter-блоку, перед першим `#`-заголовком.

**Ідемпотентність:** при ре-синку наявний блок між маркерами замінюється. Якщо `worktree: false` і старий блок є — видаляється.

Зміни в `n-cursor.js`:
- `if (file === 'auto.md') continue` → `if (file === 'meta.json') continue`
- При обробці `SKILL.md`: `injectWorktreeBlock(content, meta.worktree)`

### 3. Зміни в `auto-skills.mjs`

Парсер перемикається з `auto.md` (hand-crafted) на `meta.json` (JSON.parse):

```js
// Раніше:
const raw = readFileSync(join(dir, 'auto.md'), 'utf8').trim()
// Тепер:
const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'))
const auto = meta.auto
```

Логіка `discoverSkillAutoActivation` (перетворення умови в список правил) — без змін.

**Зворотна сумісність:** парсер спочатку шукає `meta.json`. Якщо відсутній — падає на `auto.md` з попередженням у stderr (`WARN: auto.md is deprecated...`).

### 4. JSON-схема + валідація `check`-правила

**`npm/schemas/skill-meta.schema.json`:**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema",
  "type": "object",
  "required": ["auto", "worktree"],
  "additionalProperties": false,
  "properties": {
    "auto": {
      "oneOf": [
        { "const": "завжди" },
        { "type": "array", "items": { "type": "string" }, "minItems": 1 }
      ]
    },
    "worktree": { "type": "boolean" }
  }
}
```

**Поведінка check-правила (npm-module або окремий `check-skill-meta.mjs`):**

| Стан | Результат |
|---|---|
| `meta.json` є + валідний | ✅ |
| `meta.json` є + невалідний | ❌ fail |
| `meta.json` немає, `auto.md` є | ⚠️ warn (deprecated) |
| Обидва є | ⚠️ warn (`meta.json` має пріоритет) |
| Жодного немає | ✅ (скіл без авто-активації) |

## Тестування

- `auto-skills.test.mjs` — оновити/додати кейси для `meta.json`-парсера і fallback на `auto.md`
- Новий `check-skill-meta.test.mjs` або тести в `integration-repo-checks.test.mjs` — валідація схеми й варнінги
- Unit-тест `injectWorktreeBlock` (ін'єкція/видалення блоку в `SKILL.md`)

## ADR

Рішення задокументовано в:
- `docs/adr/20260531-054150-withlock-крос-worktree-серіалізація.md` (крос-worktree locking)
- Другий ADR у тому ж файлі: `meta.json замість auto.md у скілах`
