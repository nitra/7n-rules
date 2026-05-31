# Spec A: міграція `skills/*/auto.md` → `meta.json` + поле `worktree`

**Date:** 2026-05-31
**Status:** Узгоджено (brainstorming)
**Scope:** лише `npm/skills/<id>/` (9 скілів). Правила (`npm/rules/`) не торкаємось — їх переносить окремий Spec B.

## Контекст і проблема

Кожен скіл у пакеті `@nitra/cursor` має `npm/skills/<id>/auto.md` — односторонній файл з умовою автоактивації (`завжди` | `[rule, …]` | відсутній). Його єдиний споживач — `npm/scripts/auto-skills.mjs` (`parseSkillAutoSpec` → `discoverSkillAutoActivation`), який під час синку вирішує, які скіли вписати в `.n-cursor.json:skills`. У проєкт `auto.md` **не** копіюється (`n-cursor.js:767` — `if (file === 'auto.md') continue`).

Потрібні дві речі:

1. **Структуроване, розширюване сховище метаданих скіла** замість markdown-рядка `auto.md`. Сьогодні `auto.md` тримає рівно одне значення; нове поле метаданих не має куди лягти.
2. **Нове поле `worktree`** — чи виконувати скіл в окремому git-worktree. Випливає з попередньої роботи над `withLock` (спільний крос-worktree лок, commit `6f81a15`): частина скілів виграє від ізоляції правок на гілку worktree, частина — ні.

## Рішення (узгоджені варіанти)

| Питання                         | Вибір      | Суть                                                                                            |
| ------------------------------- | ---------- | ----------------------------------------------------------------------------------------------- |
| Роль `worktree`-поля            | **A**      | Декларативна підказка для агента (не новий рантайм/CLI). Агент сам робить `git worktree add`.   |
| Як прапорець доходить до агента | **A2**     | Вшивається в копію `SKILL.md` під час синку. У проєкт не їде новий файл.                        |
| Формат файла                    | **B1**     | `meta.json` (структурований JSON, валідується схемою).                                          |
| Множина значень `worktree`      | **C1**     | Булеве `true`/`false`.                                                                          |
| Паралельність                   | —          | `worktree:true` ⇒ **заборона паралельного запуску** (один інстанс), поверх наявного `withLock`. |
| Вшивання в `SKILL.md`           | **D2**     | Згенерована markdown-секція між ідемпотентними маркерами.                                       |
| Уніфікація з rules              | відкладено | Той самий `meta.json`, але data-driven автодетект rules (G1) — окремий **Spec B**.              |

## Формат `npm/skills/<id>/meta.json`

```json
{ "auto": "завжди", "worktree": true }
```

- **`auto`** (опційне) — умова автоактивації, 1:1 семантика нинішнього `auto.md`:
  - `"завжди"` — скіл активується незалежно від правил (**українська літера-константа**, збігається з `ALWAYS_LITERAL = 'завжди'` у `auto-skills.mjs`; англійський `"always"` зламав би парсер без додаткової міграції літерала — навмисно не вводимо);
  - `["adr"]` (масив id правил, ≥1) — активується, коли ВСІ перелічені правила вже виявлені auto-rules;
  - **поле відсутнє** — opt-in лише через `.n-cursor.json:skills`.
- **`worktree`** (обовʼязкове, boolean):
  - `true` — скіл виконується в окремому git-worktree (`git worktree add`) і **заборонений до паралельного запуску** (один інстанс за раз);
  - `false` — у worktree не виконується.

### Принцип призначення `worktree`

- **`true` — генеративні скіли:** створюють зміни з детермінованого джерела (правила, survived-мутанти, latest deps, чернетки ADR). Стан робочого дерева головного checkout їм не потрібен — ізоляція на чисту гілку worktree корисна.
- **`false` — реактивні та read-only скіли:** реактивні працюють на _незакомічених змінах поточного checkout_ (як `lint` — причісує щойно зроблені правки); worktree відрізав би їх від того, що вони мають обробити. Read-only нічого не ізолюють.

## Міграція 9 скілів

| skill              | `auto` (з реального `auto.md`) | `worktree` | природа                                                                 |
| ------------------ | ------------------------------ | :--------: | ----------------------------------------------------------------------- |
| `adr-normalize`    | `["adr"]`                      |   `true`   | генеративний (мутує `docs/adr/`)                                        |
| `coverage-fix`     | `["js-lint"]`                  |   `true`   | генеративний (пише тести)                                               |
| `fix`              | `"завжди"`                     |   `true`   | генеративний (структурні правки)                                        |
| `fix-tests`        | `["js-lint"]`                  |   `true`   | генеративний (пише тести)                                               |
| `taze`             | `["bun"]`                      |   `true`   | генеративний (deps + код; worktree дає чисте дерево — передумова скіла) |
| `lint`             | `"завжди"`                     |  `false`   | реактивний (незакомічені зміни checkout)                                |
| `llm-patch`        | `"завжди"`                     |  `false`   | read-only                                                               |
| `publish-telegram` | `"завжди"`                     |  `false`   | read-only                                                               |
| `start-check`      | `"завжди"`                     |  `false`   | конфлікт портів; не пише в репо                                         |

> **Звірено з реальними файлами:** `coverage-fix/auto.md` і `fix-tests/auto.md` = `[js-lint]` (НЕ `always` — це поширена помилка в попередніх чернетках spec). `adr-normalize` = `[adr]`, `taze` = `[bun]`; решта = `завжди`.

Після створення `meta.json` файл `auto.md` у кожному скілі **видаляється повністю** (без deprecation-fallback: один формат, без подвійного джерела правди).

> Примітка: `lint` лишається `false` і **не** ділиться на легкий/важкий у цьому spec — розділення lint на quick (реактивний, `worktree:false`) і full (CI + `worktree:true`) винесено в окремий майбутній spec.

## Зміни в коді пакета

### 1. `npm/scripts/auto-skills.mjs`

`discoverSkillAutoActivation` читає `meta.json` замість `auto.md`:

- скан `npm/skills/<id>/meta.json` (замість `auto.md`);
- парсинг `meta.json.auto` у наявний `SkillAutoSpec` (`{always:true}` | `{rules:[…]}` | пропуск). Адаптувати `parseSkillAutoSpec`: вхід — JSON-значення поля `auto` (`"завжди"` | масив рядків | undefined), не markdown-рядок;
- `detectAutoSkills`, `AUTO_SKILL_ORDER`, `AUTO_SKILL_RULE_DEPENDENCIES`, `SKILL_AUTO_ACTIVATION` — публічний контракт і поведінка **незмінні**.

Edge cases: `meta.json` відсутній / невалідний JSON / `auto` відсутнє → скіл не потрапляє в автоактивацію (opt-in), як сьогодні при відсутньому `auto.md`. Помилку парсингу JSON ковтати (не валити синк).

### 2. `npm/scripts/lib/skill-meta.mjs` (новий)

Спільний хелпер читання/парсингу `meta.json` (щоб `auto-skills.mjs`, sync-логіка `n-cursor.js` і check-скрипт не дублювали парсинг):

- `readSkillMeta(skillDir) → { auto?, worktree } | null`;
- валідація форми (boolean `worktree`, `auto` — string|array|absent);
- верхній багаторядковий JSDoc українською (канон `scripts.mdc`).

### 3. `npm/bin/n-cursor.js` — `syncSkills`

- замість `if (file === 'auto.md') continue` → `if (file === 'meta.json') continue` (метадані в проєкт не копіюються);
- після копіювання файлів скіла: якщо `meta.json.worktree === true` — вшити D2-блок у скопійований `SKILL.md` у `.cursor/skills/n-<id>/SKILL.md`.

### D2: вшивання worktree-секції в `SKILL.md`

Ідемпотентний блок між маркерами (генерує новий хелпер, напр. `npm/scripts/lib/worktree-notice.mjs`):

```markdown
<!-- n-cursor:worktree:start -->

> **Worktree:** виконуй цей скіл в окремому git-worktree (`git worktree add`); **не** запускай паралельно — один інстанс за раз.

<!-- n-cursor:worktree:end -->
```

Правила вставки:

- **позиція:** після закриваючого `---` frontmatter, перед першим `#`-заголовком (детермінована, стабільна);
- блок додається **один раз**;
- **ре-синк ідемпотентний:** якщо блок між маркерами вже є — замінити його (не дублювати);
- `worktree:false` (або поле прибрали) → якщо блок між маркерами присутній, **видалити** його при ре-синку;
- маркери — стабільні літерали, не залежать від тексту всередині (текст можна змінювати без поломки ідемпотентності).

## Валідація

### JSON-схема `npm/schemas/skill-meta.json`

- `worktree`: required, `type: boolean`;
- `auto`: optional, `oneOf`: `{const:"завжди"}` | `{type:array, items:{type:string}, minItems:1}`;
- `additionalProperties: false` (на майбутні поля розширюємо явно).

### `check` (програмна перевірка)

Розширити/створити концерн правила, що валідує скіли пакета (rule-centric flat layout, `scripts.mdc`):

- кожен `npm/skills/<id>/` має `meta.json`, валідний за схемою;
- `npm/skills/<id>/auto.md` **не існує** (міграція завершена — fail, якщо лишився);
- `meta.json.worktree` присутнє і boolean.

Реалізація — Rego-first де лягає (per-document валідація `meta.json`), JS — для FS-перевірок (наявність файлу, відсутність `auto.md`). Слідувати `conftest.mdc` / `scripts.mdc`.

## Тести

- `npm/scripts/tests/auto-skills.test.mjs` — оновити фікстури на `meta.json` (тимчасові директорії з `meta.json` замість `auto.md`); зберегти всі наявні кейси (always, rule-deps, disable, недоступні скіли).
- `npm/scripts/lib/tests/skill-meta.test.mjs` (новий) — парсинг/валідація `readSkillMeta`: валідний, відсутній, невалідний JSON, `auto` відсутнє, `worktree` не-boolean.
- `npm/scripts/lib/tests/worktree-notice.test.mjs` (новий) — D2-блок: вставка, ідемпотентний ре-синк, видалення при `false`, стабільність маркерів.
- check/rego тести концерну валідації скілів.
- Регресія: повний `npm` сюїт зелений (з поправкою на наявні flaky-тести `post-tool-use-fix` readStdin і dirty-tree `integration-repo-checks`, не повʼязані з цією зміною).

## Документація і реліз

- `.cursor/rules/scripts.mdc` — рядки про структуру скіла (≈14, 51): `auto.md (опційно)` → `meta.json` (+ опис полів `auto`, `worktree`); згадка D2-секції в синкнутому `SKILL.md`.
- `npm/README.md` — згадка `auto.md` (рядок ≈117) → `meta.json`.
- Change-файл `npm/.changes/<…>.md` (`bump: minor`, `section: Changed`) — bump робить CI, не вручну (n-changelog).

## Forward reference

**Spec B** перенесе правила (`npm/rules/<id>/`) на той самий `meta.json` з **data-driven автодетектом (G1)**: прості умови (наявність файлу/каталогу, always-on, залежності від інших правил) — як дані в `meta.json`; незводимі перевірки (сканування вмісту source, розбір deps, URL repo) — як іменовані предикати в реєстрі з реалізацією в коді; `AUTO_RULE_ORDER` / `AUTO_RULE_DEPENDENCIES` — у `meta.json`. rules `meta.json` матиме лише `auto` (без `worktree` — worktree суто скілова вісь). Схема rules — окрема (E2).

## Out of scope (цей spec)

- Будь-які зміни в `npm/rules/` та `auto-rules.mjs` (→ Spec B).
- Розділення `lint` на quick/full (→ окремий майбутній spec).
- Рантайм/CLI, що сам створює worktree й запускає скіл (рішення A: лише декларативна підказка).
- Deprecation-fallback на `auto.md` — навмисно НЕ робимо (один формат).
