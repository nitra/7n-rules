# CI4-модель `@nitra/cursor` — дизайн-спека

Дата: 2026-05-10
Власник: @vitaliytv
Статус: Draft (очікує апруву)

## Мета

Описати продукт `@nitra/cursor` у форматі CI4 (C4-style архітектурна документація, локально перейменовано на `ci4`) з підтримкою двостороннього кросс-лінку з ADR-чернетками у `docs/adr/_inbox/`.

CI4-модель потрібна як стабільна точка опору для onboarding, ADR-кураторства й рев'ю змін у поведінці CLI / hook'ів.

## Передісторія

Рішення робити CI4-модель саме у структурі `docs/ci4/{01-context, 02-containers, 03-components, 04-code, decisions}.md` уже зафіксоване в **ADR `docs/adr/_inbox/20260510-112235-20fb5843.md`** — попередній брейнштормінг-сесії, яку Stop-hook автоматично закаптурив. Цей spec — імплементаційна референція для того ADR (з невеликою дельтою, див. нижче).

Контекст: 2026-05-10 у пакет `@nitra/cursor` додано саме правило **`ci4.mdc`** (v1.8.221), яке зобов'язує **кожен** проєкт-споживач робити CI4 (ADR `20260510-112851-861696eb.md`, `20260510-113127-861696eb.md`). Цей spec — перше застосування правила, причому **до самого продюсера правила**: `n-cursor` документує себе своєю ж конвенцією.

**Дельта порівняно з ADR `20260510-112235-20fb5843`:**

- L4 розширено з 2 (Check Runner, AGENTS Builder) до **5** (всі runtime-контейнери) — за уточненням під час сесії 2026-05-10 ("ці і можна і інші охопити").
- Додано вимогу **посилання на тести** для кожного L3-компонента — згідно з принципом ci4.mdc "Зв'язок із тестами", який не існував на момент попереднього ADR.
- Пояснено таксономію якорів (`#ctx-*`, `#cnt-*`, `#cmp-*`, `#code-*`).

## Scope

**In:**

- npm-пакет `@nitra/cursor` (вміст `npm/` цього репо).
- Усі 4 рівні C4: Context, Containers, Components, Code.
- Опис кросс-лінку CI4 ↔ ADR і конвенція стабільних якорів.

**Out:**

- Воркспейс `demo/`.
- Сусідні `@nitra/*` пакети (cspell-dict, eslint-config, stylelint-config, minify-image тощо) — лише як external systems на L1.
- Внутрішня архітектура Cursor IDE / Claude Code / GitHub Actions runner — лише як external systems.
- Автогенерація діаграм зі скриптів і CI-валідація діаграм.
- Щось у форматі **C4-PlantUML** / **Structurizr DSL**.

## Deliverable

Каталог `docs/ci4/`:

```text
docs/ci4/
├── README.md         # індекс CI4: що це, як читати, як лінкувати з ADR
├── 01-context.md     # L1 — System Context
├── 02-containers.md  # L2 — Containers
├── 03-components.md  # L3 — Components (по контейнеру)
├── 04-code.md        # L4 — Code (drill-in для runtime-контейнерів)
└── decisions.md      # централізований cross-ref CI4 ↔ ADR
```

Формат — Mermaid у Markdown (`C4Context` / `C4Container` / `C4Component`, плюс `flowchart` / `classDiagram` для L4). Жодних додаткових інструментів для рендеру не потрібно — все читається в GitHub / Cursor / VS Code / Obsidian.

Мова — українська, технічні терміни англійською (узгоджено з `AGENTS.md`).

## Зміст по рівнях

### L1 — Context (`01-context.md`)

Одна `C4Context`-діаграма + текстова таблиця акторів. Центральна система — `n-cursor`. Зовнішні актори:

- **Розробник** — запускає CLI у терміналі.
- **AI-агент** (Cursor IDE, Claude Code) — і користувач (через slash-команди / hooks), і споживач артефактів (`AGENTS.md`, `.cursor/rules/`, `.cursor/skills/`).
- **Цільовий репозиторій** — read/write на `.cursor/`, `.claude/`, `AGENTS.md`, `.n-cursor.json`, `docs/adr/_inbox/`.
- **npm Registry / npx-кеш** — звідки витягується tarball пакету.
- **Зовнішні CLI-лінтери**: `oxlint`, `eslint`, `jscpd`, `stylelint`, `cspell`, `markdownlint-cli2`, `v8r`, `hadolint`, `kubeconform`, `regal`, `conftest`, `shellcheck`, `oxfmt`.
- **LLM CLI**: `claude` (Anthropic Claude Code) і `cursor-agent` (Cursor IDE) — викликаються лише з Capture-Decisions Hook.
- **GitHub Actions runner** — використовує composite action `setup-bun-deps`.

### L2 — Containers (`02-containers.md`)

Одна `C4Container`-діаграма + таблиця. **6 контейнерів**:

| ID | Назва | Тип | Точка входу |
|---|---|---|---|
| `cnt-rule-sync` | CLI: Rule Sync | Bun runtime | `n-cursor` (без аргументів) |
| `cnt-check-runner` | CLI: Check Runner | Bun runtime | `n-cursor check [...rules]` |
| `cnt-stop-hook` | CLI: Stop-Hook | Bun runtime | `n-cursor stop-hook` |
| `cnt-capture-decisions` | Capture-Decisions Hook | Bash + jq + LLM CLI | `.claude/hooks/capture-decisions.sh` |
| `cnt-gh-action` | GitHub Action: setup-bun-deps | composite action | `npm/github-actions/setup-bun-deps/action.yml` |
| `cnt-pkg-artifact` | Package Artifact | Data store (tarball) | tarball у npm-кеші / `node_modules/@nitra/cursor` |

Усі CLI-контейнери — це різні режими одного бінарника `bin/n-cursor.js`, але в C4 моделюються як окремі контейнери, бо мають різні тригери, зовнішні інтерфейси й споживачів.

### L3 — Components (`03-components.md`)

Одна `C4Component`-діаграма на runtime-контейнер (4 шт.) + таблиці. Передбачувані компоненти:

- **Rule Sync** (`cnt-rule-sync`):
  - `cmp-load-config` (`utils/load-cursor-config.mjs`)
  - `cmp-sync-rules` (копіювання `mdc/*.mdc` → `.cursor/rules/n-*.mdc`)
  - `cmp-sync-skills` (копіювання `skills/*` → `.cursor/skills/n-*/`)
  - `cmp-build-agents` (`build-agents-commands.mjs` + mustache-render `AGENTS.template.md`)
  - `cmp-sync-claude` (`sync-claude-config.mjs` — інсталяція hook-ів і `.claude/settings.json`)
  - `cmp-sync-gha` (`sync-setup-bun-deps-action.mjs`)
  - `cmp-ensure-devdep` (`ensure-nitra-cursor-dev-dependencies.mjs`)
- **Check Runner** (`cnt-check-runner`):
  - `cmp-cli-entry` (`cli-entry.mjs`)
  - `cmp-check-reporter` (`check-reporter.mjs`)
  - реєстр `cmp-check-<rule>` (по одному `check-*.mjs` на правило)
  - `cmp-utils` (shared `scripts/utils/*`)
- **Stop-Hook** (`cnt-stop-hook`):
  - `cmp-jsonl-reader` (parsing transcript stdin)
  - `cmp-lint-runner` (re-invokes `bun run lint`)
  - `cmp-exit-marshaller` (нормалізація exit-code)
- **Capture-Decisions** (`cnt-capture-decisions`):
  - `cmp-cli-selector` (`claude` → `cursor-agent` fallback chain)
  - `cmp-jq-pipeline` (екстракт text/thinking/tool_use з JSONL)
  - `cmp-inbox-writer` (запис у `docs/adr/_inbox/`)
  - `cmp-recursion-guard` (env-var `CAPTURE_DECISIONS_RUNNING`)

GH Action і Package Artifact — без діаграм L3, тільки таблиці (тривіальна структура).

#### Посилання на тести (обов'язково за `ci4.mdc`)

Кожен L3-компонент має колонку `Tests` у таблиці — посилання на відповідні файли в `npm/tests/`. Передбачуване мапування (фінал — у самому документі):

| Компонент | Tests |
|---|---|
| `cmp-load-config` | [`utils-load-cursor-config.test.mjs`](../../npm/tests/utils-load-cursor-config.test.mjs) |
| `cmp-build-agents` | [`agents-md-commands.test.mjs`](../../npm/tests/agents-md-commands.test.mjs) |
| `cmp-sync-claude` | [`sync-claude-config.test.mjs`](../../npm/tests/sync-claude-config.test.mjs) |
| `cmp-sync-gha` | [`sync-setup-bun-deps-action.test.mjs`](../../npm/tests/sync-setup-bun-deps-action.test.mjs) |
| `cmp-ensure-devdep` | [`ensure-nitra-cursor-dev-dependencies.test.mjs`](../../npm/tests/ensure-nitra-cursor-dev-dependencies.test.mjs) |
| `cmp-cli-entry` | [`cli-entry.test.mjs`](../../npm/tests/cli-entry.test.mjs) |
| `cmp-check-reporter` | [`check-reporter.test.mjs`](../../npm/tests/check-reporter.test.mjs) |
| `cmp-check-<rule>` | відповідний `check-<rule>.test.mjs` (по одному файлу на правило) |
| `cmp-utils` | `utils-*.test.mjs` |

Якщо для компонента **немає** тесту — у клітинці `Tests` пишемо `—` і додаємо запис у `decisions.md` як технічний борг.

### L4 — Code (`04-code.md`)

Code-level діаграми (Mermaid `flowchart` / `classDiagram`) для **всіх runtime-контейнерів**:

- `code-rule-sync` — pipeline всередині `bin/n-cursor.js` для default-команди.
- `code-agents-builder` — drill-in підпотоку: `package.json` → `build-agents-commands.mjs` → render → fs write.
- `code-check-runner` — `bin/n-cursor.js → cli-entry.mjs → check-{id}.mjs → check-reporter.mjs` з прикладом одного `check-text.mjs`.
- `code-stop-hook` — JSONL stdin → lint subprocess → exit code.
- `code-capture-decisions` — bash flow з вибором LLM CLI.

GH Action і Package Artifact — без L4.

## Стабільні якорі (cross-link contract)

Кожен елемент CI4 має детермінований ID-якорь. Префікс-таксономія:

- `#ctx-*` — actor / external system на L1
- `#cnt-*` — container на L2
- `#cmp-*` — component на L3
- `#code-*` — code-level artefact на L4

Якорі задаються в Markdown через `<a id="cnt-rule-sync"></a>` (а не лише через автогенеровані `## Rule Sync`-якорі), щоб витримували перейменування заголовка. ADR посилаються виключно на ці explicit-якорі.

## Кросс-лінк з ADR

**Двостороння модель:**

1. **Централізований cross-ref** — `docs/ci4/decisions.md`. Таблиця:

   | Element | Element ID | ADR | Дата | Резюме |
   |---|---|---|---|---|
   | Rule Sync | `cnt-rule-sync` | `docs/adr/_inbox/20260509-...md` | 2026-05-09 | … |

2. **Дублюючі секції в файлах рівнів** — кожен файл `01..04-*.md` у кінці має секцію `## Related decisions` зі списком relevant ADR-ів для елементів цього рівня. Дублювання навмисне: при читанні рівня видно контекст, а `decisions.md` залишається індексом для глобального пошуку.

3. **Зворотні посилання з ADR** — у тілі ADR-чернетки додається рядок `Related CI4: [Rule Sync](../ci4/02-containers.md#cnt-rule-sync)`. Це робиться **вручну при кураторстві** з `_inbox/` (документується в `docs/ci4/README.md` як крок процесу).

**Bootstrap для `decisions.md`** — три вже існуючі сьогоднішні ADR-чернетки:

| Element ID | ADR | Резюме |
|---|---|---|
| `cnt-pkg-artifact`, `cmp-build-agents` (правило `ci4`) | `docs/adr/_inbox/20260510-112851-861696eb.md` | Правило `ci4.mdc` наповнено 6 принципами; v1.8.221 |
| `cnt-pkg-artifact` | `docs/adr/_inbox/20260510-113127-861696eb.md` | Дублює попередній (близький timestamp); прибрати при кураторстві або злити |
| вся CI4-модель (meta) | `docs/adr/_inbox/20260510-112235-20fb5843.md` | Рішення про структуру `docs/ci4/` і вибір Mermaid |

Решту 80+ драфтів у `_inbox/` інтегруємо ітеративно при кураторстві.

## Свідомі обмеження (won't do)

- Не описуємо `demo/` — поза scope.
- Не вмонтовуємо C4-PlantUML / Structurizr DSL — Mermaid достатньо.
- Не генеруємо діаграми скриптами — пишемо вручну, оновлюємо при змінах архітектури.
- Не дублюємо реліз-правила з `npm/CLAUDE.md` / `n-changelog.mdc` — посилаємось.
- Не валідуємо діаграми в CI — діаграми як прозовий артефакт, помилка ламає рендер у переглядачі, цього достатньо.

## Ризики

| Ризик | Мітигація |
|---|---|
| Якорі дрифтять при рефакторингу файлів рівнів | explicit `<a id="...">` тільки на стабільних elements, префікс-таксономія, гарантовано відсутні дубліклати |
| `_inbox/` має 80+ ADR — повний cross-ref ручний і затратний | Bootstrap лінкує лише relevant; кураторство ADR продовжує наповнювати таблицю |
| `decisions.md` і inline-секції розходяться | Конвенція в `README.md`: при додаванні ADR-посилання — оновити обидва місця; check можна додати пізніше окремою задачею (не в цьому scope) |
| 6 контейнерів моделюють те, що технічно є одним бінарником `bin/n-cursor.js` | Виправдано різними тригерами / users / SLA; описано в `02-containers.md` як свідоме рішення |

## План імплементації (узагальнено)

Детальний step-by-step план піде у наступний документ через `writing-plans`. Очікувана послідовність:

1. Створити `docs/ci4/` зі скелетом 6 файлів і коректними `<a id="">`-якорями.
2. Заповнити `01-context.md` (одна `C4Context`-діаграма + таблиця).
3. Заповнити `02-containers.md` (одна `C4Container`-діаграма + таблиця 6 контейнерів).
4. Заповнити `03-components.md` (4 `C4Component`-діаграми + таблиці).
5. Заповнити `04-code.md` (5 code-flow діаграм).
6. Зробити `decisions.md` (порожня шапка + bootstrap-таблиця для 3-5 ADR, які явно згадують `npm/`-файли).
7. Заповнити `README.md` (як читати, як лінкувати з ADR, конвенція якорів).
8. Перевірити: `markdownlint-cli2`, `cspell`, mermaid-блоки рендеряться (візуально в Cursor).

CHANGELOG / version bump npm-пакета — **не потрібні**: зміни тільки в `docs/`, `npm/` не торкаємо.
