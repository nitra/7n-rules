# Дизайн: реорганізація npm-пакету навколо директорій правил

**Дата:** 2026-05-14  
**Статус:** Затверджено

---

## 1. Контекст

Зараз файли одного правила (`.mdc`, `.rego`, `check-*.mjs`, `run-*.mjs`) розкидані по чотирьох каталогах:

| Де зараз                | Що містить                                                |
| ----------------------- | --------------------------------------------------------- |
| `npm/mdc/`              | 26 файлів `*.mdc`                                         |
| `npm/policy/`           | rego-поліси 24 правил (snake_case каталоги)               |
| `npm/scripts/`          | 25 `check-*.mjs` + 8 `run-*/lint-*` + 11 інфраструктурних |
| `npm/bin/auto-rules.md` | умови автоактивації всіх правил                           |

Видалити одне правило — означає вичищати 4 різні місця. Нова CI4-правило чи правило-видалення — ризик упустити файл.

---

## 2. Ціль

Одне правило = одна директорія в `npm/rules/{rule}/`. Видалення директорії — повна очистка правила без решток.

Та сама інваріанта поширюється і на скіли: одна директорія в `npm/skills/{skill}/` тримає увесь скіл (текст, умова автоактивації, скрипти, тести). Видалив `npm/skills/abie-clean/` → скіл `abie-clean` зник без сліду.

Тести співрозташовуються з джерельними файлами (`*.test.mjs` поруч з `*.mjs`). `npm/tests/` максимально декомпозується: усе, що логічно прив'язане до конкретного правила/скіла, переїжджає в його каталог; крос-правильні тести розрізаються на per-rule шматки де це можливо.

---

## 3. Нова структура

### 3.1 Кореневий рівень `npm/rules/`

```
npm/rules/
├── abie/
├── adr/
├── bun/
├── capacitor/
├── changelog/
├── ci4/
├── docker/
├── ga/
├── graphql/
├── hasura/
├── image-avif/
├── image-compress/
├── js-bun-db/
├── js-bun-redis/
├── js-lint/
├── js-mssql/
├── js-run/
├── k8s/
├── nginx-default-tpl/
├── npm-module/
├── php/
├── rego/
├── style-lint/
├── tauri/
├── text/
└── vue/
```

Іменування: **kebab-case** (уніфікація; `policy/` мала snake_case, тепер стане kebab).

### 3.2 Внутрішня структура директорії правила

```
npm/rules/{rule}/
├── {rule}.mdc        ← текст правила (з npm/mdc/{rule}.mdc)
├── auto.md           ← умови автоактивації + посилання на skill (з auto-rules.md)
├── policy/           ← rego-поліси (з npm/policy/{snake_rule}/)  [якщо є]
│   ├── *.rego
│   └── *_test.rego
└── js/               ← JS-скрипти правила [якщо є]
    ├── check.mjs     ← (з npm/scripts/check-{rule}.mjs)
    ├── run.mjs       ← (якщо був run-{rule}.mjs)
    └── lint.mjs      ← (якщо був lint-{rule}.mjs)
```

Файли в `js/` **не мають суфікса правила**: директорія вже є namespace.

### 3.3 Маппінг файлів → нові шляхи

#### check-\*.mjs (25 файлів)

| Було                                  | Стане                                  |
| ------------------------------------- | -------------------------------------- |
| `scripts/check-abie.mjs`              | `rules/abie/js/check.mjs`              |
| `scripts/check-adr.mjs`               | `rules/adr/js/check.mjs`               |
| `scripts/check-bun.mjs`               | `rules/bun/js/check.mjs`               |
| `scripts/check-capacitor.mjs`         | `rules/capacitor/js/check.mjs`         |
| `scripts/check-changelog.mjs`         | `rules/changelog/js/check.mjs`         |
| `scripts/check-docker.mjs`            | `rules/docker/js/check.mjs`            |
| `scripts/check-ga.mjs`                | `rules/ga/js/check.mjs`                |
| `scripts/check-graphql.mjs`           | `rules/graphql/js/check.mjs`           |
| `scripts/check-hasura.mjs`            | `rules/hasura/js/check.mjs`            |
| `scripts/check-image-avif.mjs`        | `rules/image-avif/js/check.mjs`        |
| `scripts/check-image-compress.mjs`    | `rules/image-compress/js/check.mjs`    |
| `scripts/check-js-bun-db.mjs`         | `rules/js-bun-db/js/check.mjs`         |
| `scripts/check-js-bun-redis.mjs`      | `rules/js-bun-redis/js/check.mjs`      |
| `scripts/check-js-lint.mjs`           | `rules/js-lint/js/check.mjs`           |
| `scripts/check-js-mssql.mjs`          | `rules/js-mssql/js/check.mjs`          |
| `scripts/check-js-run.mjs`            | `rules/js-run/js/check.mjs`            |
| `scripts/check-k8s.mjs`               | `rules/k8s/js/check.mjs`               |
| `scripts/check-nginx-default-tpl.mjs` | `rules/nginx-default-tpl/js/check.mjs` |
| `scripts/check-npm-module.mjs`        | `rules/npm-module/js/check.mjs`        |
| `scripts/check-php.mjs`               | `rules/php/js/check.mjs`               |
| `scripts/check-rego.mjs`              | `rules/rego/js/check.mjs`              |
| `scripts/check-style-lint.mjs`        | `rules/style-lint/js/check.mjs`        |
| `scripts/check-tauri.mjs`             | `rules/tauri/js/check.mjs`             |
| `scripts/check-text.mjs`              | `rules/text/js/check.mjs`              |
| `scripts/check-vue.mjs`               | `rules/vue/js/check.mjs`               |

#### run-_/lint-_ (8 файлів)

| Було                              | Стане                              |
| --------------------------------- | ---------------------------------- |
| `scripts/lint-ga.mjs`             | `rules/ga/js/lint.mjs`             |
| `scripts/lint-rego.mjs`           | `rules/rego/js/lint.mjs`           |
| `scripts/run-docker.mjs`          | `rules/docker/js/run.mjs`          |
| `scripts/run-k8s.mjs`             | `rules/k8s/js/run.mjs`             |
| `scripts/run-php.mjs`             | `rules/php/js/run.mjs`             |
| `scripts/run-shellcheck-text.mjs` | `rules/text/js/run-shellcheck.mjs` |
| `scripts/run-v8r.mjs`             | `rules/text/js/run-v8r.mjs`        |

#### policy/ (24 директорії, snake_case → kebab-case)

| Було                                    | Стане                             |
| --------------------------------------- | --------------------------------- |
| `policy/abie/`                          | `rules/abie/policy/`              |
| `policy/image_avif/`                    | `rules/image-avif/policy/`        |
| `policy/image_compress/`                | `rules/image-compress/policy/`    |
| `policy/js_bun_db/`                     | `rules/js-bun-db/policy/`         |
| `policy/nginx_default_tpl/`             | `rules/nginx-default-tpl/policy/` |
| ... (решта — без snake→kebab конверсії) | ...                               |

### 3.4 `npm/scripts/` — залишається: лише інфраструктура

```
npm/scripts/
├── auto-rules.mjs           ← тепер читає rules/*/auto.md
├── auto-skills.mjs          ← тепер читає skills/*/auto.md
├── build-agents-commands.mjs
├── claude-stop-hook.mjs
├── cli-entry.mjs
├── ensure-nitra-cursor-dev-dependencies.mjs
├── lint-conftest.mjs        ← батч-раннер по rules/*/policy/
├── rename-yaml-extensions.mjs
├── sync-claude-config.mjs
├── sync-setup-bun-deps-action.mjs
├── upgrade-nitra-cursor-and-install.mjs
└── utils/
```

### 3.5 Формат `rules/{rule}/auto.md`

Кожна директорія правила тримає лише свою умову автоактивації. Skills'ові умови живуть у `skills/{skill}/auto.md` (див. 3.6) — НЕ всередині `rules/*/auto.md`.

Зміст файлу — тіло одного рядка з поточного `bin/auto-rules.md`, без префіксу `{rule} -` (ім'я правила вже несе директорія):

```markdown
якщо в кореневому package.json в секції "repository" присутній текст "<https://github.com/abinbevefes/**/>"
```

Залежність від інших правил (поточний синтаксис `changelog - [bun]`):

```markdown
[bun]
```

Якщо у правила немає умов автоактивації (правило завжди опт-ін через `.n-cursor.json:rules`) — файл `auto.md` не створюється.

### 3.6 `npm/skills/{skill}/` — паралельна структура

Скіли отримують ту саму внутрішню організацію, що й правила:

```
npm/skills/{skill}/
├── SKILL.md           ← конвенція Cursor/Claude (не перейменовується)
├── auto.md            ← умова автоактивації (з npm/bin/auto-skills.md)
└── js/                ← JS-скрипти скіла (поки порожньо, готова під майбутні)
    └── *.test.mjs     ← тести поруч із джерельними файлами
```

Поточні скіли (`abie-clean`, `abie-kustomize`, `abie-tr`, `fix`, `lint`, `llm-patch`, `publish-telegram`, `taze`) — кожен отримує `auto.md` з відповідною умовою з `bin/auto-skills.md`.

Файли в `js/` (коли з'являться) — без суфікса скіла, бо директорія вже namespace.

### 3.7 Тести — співрозташування з джерельними файлами

Поточні ~50 файлів у `npm/tests/` переїжджають за принципом «тест поруч з тим, що він тестує».

#### Маппінг тестів правил

| Зараз                                    | Стає                                                                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `tests/check-abie.test.mjs`              | `rules/abie/js/check.test.mjs`                                                                                         |
| `tests/check-bun.test.mjs`               | `rules/bun/js/check.test.mjs`                                                                                          |
| `tests/check-capacitor.test.mjs`         | `rules/capacitor/js/check.test.mjs`                                                                                    |
| `tests/check-changelog.test.mjs`         | `rules/changelog/js/check.test.mjs`                                                                                    |
| `tests/check-docker-compile.test.mjs`    | `rules/docker/js/check-compile.test.mjs`                                                                               |
| `tests/check-docker-mirror.test.mjs`     | `rules/docker/js/check-mirror.test.mjs`                                                                                |
| `tests/check-docker-multistage.test.mjs` | `rules/docker/js/check-multistage.test.mjs`                                                                            |
| `tests/check-docker-nginx-slim.test.mjs` | `rules/docker/js/check-nginx-slim.test.mjs`                                                                            |
| `tests/check-docker-nonroot.test.mjs`    | `rules/docker/js/check-nonroot.test.mjs`                                                                               |
| `tests/check-env-scan.test.mjs`          | `rules/js-run/js/check-env-scan.test.mjs` (бо `check-env-scan.mjs` живе у `utils/`, але юзає його лише `check-js-run`) |
| `tests/check-ga.test.mjs`                | `rules/ga/js/check.test.mjs`                                                                                           |
| `tests/check-graphql.test.mjs`           | `rules/graphql/js/check.test.mjs`                                                                                      |
| `tests/check-hasura.test.mjs`            | `rules/hasura/js/check.test.mjs`                                                                                       |
| `tests/check-image-avif.test.mjs`        | `rules/image-avif/js/check.test.mjs`                                                                                   |
| `tests/check-image-compress.test.mjs`    | `rules/image-compress/js/check.test.mjs`                                                                               |
| `tests/check-js-bun-db.test.mjs`         | `rules/js-bun-db/js/check.test.mjs`                                                                                    |
| `tests/check-js-lint.test.mjs`           | `rules/js-lint/js/check.test.mjs`                                                                                      |
| `tests/check-js-run-fixture.test.mjs`    | `rules/js-run/js/check-fixture.test.mjs`                                                                               |
| `tests/check-k8s-images.test.mjs`        | `rules/k8s/js/check-images.test.mjs`                                                                                   |
| `tests/check-k8s-schema.test.mjs`        | `rules/k8s/js/check-schema.test.mjs`                                                                                   |
| `tests/check-nginx-default-tpl.test.mjs` | `rules/nginx-default-tpl/js/check.test.mjs`                                                                            |
| `tests/check-npm-module.test.mjs`        | `rules/npm-module/js/check.test.mjs`                                                                                   |
| `tests/check-text-fixture.test.mjs`      | `rules/text/js/check-fixture.test.mjs`                                                                                 |
| `tests/lint-ga.test.mjs`                 | `rules/ga/js/lint.test.mjs`                                                                                            |
| `tests/run-shellcheck-text.test.mjs`     | `rules/text/js/run-shellcheck.test.mjs`                                                                                |
| `tests/run-v8r-catalog.test.mjs`         | `rules/text/js/run-v8r-catalog.test.mjs`                                                                               |
| `tests/run-k8s-roots.test.mjs`           | `rules/k8s/js/run-roots.test.mjs`                                                                                      |
| `tests/docker-discover.test.mjs`         | `rules/docker/js/discover.test.mjs`                                                                                    |

#### Маппінг тестів інфраструктури → поруч з джерелами в `npm/scripts/`

| Зараз                                                 | Стає                                                    |
| ----------------------------------------------------- | ------------------------------------------------------- |
| `tests/agents-md-commands.test.mjs`                   | `scripts/build-agents-commands.test.mjs`                |
| `tests/auto-rules.test.mjs`                           | `scripts/auto-rules.test.mjs`                           |
| `tests/auto-skills.test.mjs`                          | `scripts/auto-skills.test.mjs`                          |
| `tests/cli-entry.test.mjs`                            | `scripts/cli-entry.test.mjs`                            |
| `tests/ensure-nitra-cursor-dev-dependencies.test.mjs` | `scripts/ensure-nitra-cursor-dev-dependencies.test.mjs` |
| `tests/rename-yaml-extensions.test.mjs`               | `scripts/rename-yaml-extensions.test.mjs`               |
| `tests/sync-claude-config.test.mjs`                   | `scripts/sync-claude-config.test.mjs`                   |
| `tests/sync-setup-bun-deps-action.test.mjs`           | `scripts/sync-setup-bun-deps-action.test.mjs`           |
| `tests/upgrade-nitra-cursor-and-install.test.mjs`     | `scripts/upgrade-nitra-cursor-and-install.test.mjs`     |
| `tests/check-reporter.test.mjs`                       | `scripts/utils/check-reporter.test.mjs`                 |
| `tests/conn-imports-scan.test.mjs`                    | `scripts/utils/conn-imports-scan.test.mjs`              |
| `tests/conn-file-rules.test.mjs`                      | `scripts/utils/conn-file-rules.test.mjs`                |
| `tests/bunyan-imports.test.mjs`                       | `scripts/utils/bunyan-imports.test.mjs`                 |
| `tests/redis-imports.test.mjs`                        | `scripts/utils/redis-imports.test.mjs`                  |
| `tests/promise-settimeout-scan.test.mjs`              | `scripts/utils/promise-settimeout-scan.test.mjs`        |
| `tests/gha-workflow.test.mjs`                         | `scripts/utils/gha-workflow.test.mjs`                   |
| `tests/utils-walkDir.test.mjs`                        | `scripts/utils/walkDir.test.mjs`                        |
| `tests/utils-pass.test.mjs`                           | `scripts/utils/pass.test.mjs`                           |
| `tests/utils-workspaces.test.mjs`                     | `scripts/utils/workspaces.test.mjs`                     |
| `tests/utils-load-cursor-config.test.mjs`             | `scripts/utils/load-cursor-config.test.mjs`             |

#### Розрізання крос-правильних тестів

| Зараз                                    | Стає                                                                                                                                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/integration-repo-checks.test.mjs` | 9 окремих `rules/{rule}/js/integration.test.mjs` для abie, bun, docker, ga, graphql, js-lint, js-run, k8s, npm-module, text — кожен імпортує власний `check` і дим-тестує на корені репо |
| `tests/check-rule-fixtures.test.mjs`     | `rules/nginx-default-tpl/js/check-fixtures.test.mjs`, `rules/style-lint/js/check-fixtures.test.mjs`, `rules/vue/js/check-fixtures.test.mjs`                                              |
| `tests/check-empty-trees.test.mjs`       | Розрізати на per-rule аспект «правило не падає на порожньому дереві»: `rules/{rule}/js/check-empty.test.mjs` для кожного правила, яке тест охоплює                                       |

#### Fixtures та helpers

| Зараз                                         | Стає                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------- |
| `tests/fixtures/k8s/*`                        | `rules/k8s/js/fixtures/`                                             |
| `tests/fixtures/text/*`                       | `rules/text/js/fixtures/`                                            |
| `tests/fixtures/{rule}/*`                     | `rules/{rule}/js/fixtures/` (якщо fixture тільки для одного правила) |
| `tests/fixtures/*` (спільні між ≥2 правилами) | лишаються в `npm/tests/fixtures/`                                    |
| `tests/helpers.mjs`                           | `scripts/utils/test-helpers.mjs`                                     |

#### Доля `npm/tests/`

Після міграції каталог звужується до спільних fixtures (якщо такі лишилися після per-rule розрізання). Якщо нічого спільного не лишилось — каталог видаляється повністю.

#### `package.json#scripts.test`

Було:

```json
"test": "bun test tests"
```

Стає:

```json
"test": "bun test"
```

`bun test` без аргументу шукає `*.test.mjs` рекурсивно по всьому пакету — підбере і `rules/*/js/*.test.mjs`, і `skills/*/js/*.test.mjs`, і `scripts/*.test.mjs`, і `scripts/utils/*.test.mjs`.

---

## 4. Зміни в `bin/n-cursor.js`

### 4.1 Нові константи

```js
const BUNDLED_RULES_DIR = join(binDir, '..', 'rules')
// BUNDLED_SCRIPTS_DIR залишається для scripts/utils і спільних скриптів
```

### 4.2 Динамічний пошук check-скриптів

Замінити readdir по `scripts/` з фільтром `check-*.mjs` на:

```js
// Було
const names = await readdir(BUNDLED_SCRIPTS_DIR)
  .filter(n => n.startsWith('check-') && n.endsWith('.mjs'))
  .map(n => n.slice('check-'.length, -'.mjs'.length))

// Стане
const entries = await readdir(BUNDLED_RULES_DIR, { withFileTypes: true })
const names = entries
  .filter(e => e.isDirectory())
  .filter(e => existsSync(join(BUNDLED_RULES_DIR, e.name, 'js', 'check.mjs')))
  .map(e => e.name)
```

### 4.3 Шлях до check-скрипту

```js
// Було
const scriptPath = join(BUNDLED_SCRIPTS_DIR, `check-${rule}.mjs`)

// Стане
const scriptPath = join(BUNDLED_RULES_DIR, rule, 'js', 'check.mjs')
```

### 4.4 Статичні імпорти

```js
// Було
import { runLintGaCli } from '../scripts/lint-ga.mjs'

// Стане
import { runLintGaCli } from '../rules/ga/js/lint.mjs'
```

Аналогічно для всіх `scripts/check-*`, `scripts/run-*`, `scripts/lint-ga`, `scripts/lint-rego`.

### 4.5 `auto-rules.mjs` та `auto-skills.mjs`

Ці файли читають `bin/auto-rules.md` та `bin/auto-skills.md`. Після реорганізації:

- `auto-rules.mjs` читає всі `rules/*/auto.md`
- `auto-skills.mjs` читає всі `skills/*/auto.md`
- `bin/auto-rules.md` та `bin/auto-skills.md` **видаляються**

Формат per-skill `auto.md` дзеркалить per-rule (тіло рядка з `bin/auto-skills.md`, без префіксу `{skill} -`):

```markdown
[abie]
```

Для скілів, що активуються завжди (`fix`, `lint`, `llm-patch`, `publish-telegram`):

```markdown
завжди
```

Парсер у `auto-skills.mjs` розпізнає три варіанти: відсутній файл (опт-ін через `.n-cursor.json:skills`), `[<rule>]` (увімкнено, якщо `<rule>` активне), `завжди` (увімкнено за замовчуванням).

### 4.6 `lint-conftest.mjs`

Замінити шлях до `policy/` на `rules/*/policy/`.

---

## 5. Зміни в `package.json`

```json
// Було
"files": ["types", "mdc", "bin", "github-actions", "policy", "schemas", "scripts", "skills", ...]

// Стане
"files": ["types", "rules", "bin", "github-actions", "schemas", "scripts", "skills", ...]
```

`mdc` та `policy` прибираються; `rules` додається.

---

## 6. Зміни в `.cursor/rules/*.mdc`

У правилах `CLAUDE.md` та `*.mdc` всередині проєкту є посилання на `npm/mdc/` та `npm/policy/`. Треба обновити на `npm/rules/`.

Перевірити: `grep -r "npm/mdc\|npm/policy" .cursor/rules/`.

---

## 7. Порядок виконання

1. **Підготовка:** створити `npm/rules/` зі структурою директорій. Для кожного скіла переконатись, що `npm/skills/{skill}/` існує.
2. **Перемістити `.mdc`:** `npm/mdc/{rule}.mdc` → `npm/rules/{rule}/{rule}.mdc`.
3. **Перемістити `policy/`:** `npm/policy/{snake_rule}/` → `npm/rules/{rule}/policy/` (з конверсією snake→kebab).
4. **Перемістити check-\*.mjs:** `npm/scripts/check-{rule}.mjs` → `npm/rules/{rule}/js/check.mjs`.
5. **Перемістити run-_/lint-_:** 7 файлів за маппінгом у п. 3.3.
6. **Створити `rules/*/auto.md`** у кожній директорії правила (вирізати з `bin/auto-rules.md`).
7. **Створити `skills/*/auto.md`** у кожній директорії скіла (вирізати з `bin/auto-skills.md`).
8. **Перемістити тести правил:** `tests/check-{rule}*.test.mjs` → `rules/{rule}/js/*.test.mjs` (за маппінгом у п. 3.7).
9. **Перемістити тести інфраструктури:** `tests/*.test.mjs` → `scripts/*.test.mjs` або `scripts/utils/*.test.mjs` (за маппінгом).
10. **Розрізати крос-правильні тести:** `integration-repo-checks`, `check-rule-fixtures`, `check-empty-trees` → per-rule файли.
11. **Перемістити fixtures:** per-rule fixtures → `rules/{rule}/js/fixtures/`; спільні — лишаються в `npm/tests/fixtures/`.
12. **Перемістити `tests/helpers.mjs`** → `scripts/utils/test-helpers.mjs`; оновити імпорти в усіх тестах.
13. **Оновити `bin/n-cursor.js`:** нові шляхи, нова логіка readdir.
14. **Оновити `scripts/auto-rules.mjs`:** читати `rules/*/auto.md`.
15. **Оновити `scripts/auto-skills.mjs`:** читати `skills/*/auto.md`.
16. **Оновити `scripts/lint-conftest.mjs`:** нові шляхи до `policy/`.
17. **Оновити `package.json#files`** та `package.json#scripts.test` (`bun test tests` → `bun test`).
18. **Видалити** `npm/mdc/`, `npm/policy/`, `bin/auto-rules.md`, `bin/auto-skills.md`, та `npm/tests/` (якщо порожньо після п. 11).
19. **Запустити тести та `npx @nitra/cursor check`.**

---

## 8. Що не змінюється

- `npm/scripts/` — залишаються 11 спільних файлів + `utils/` (плюс тести інфраструктури переїжджають сюди)
- Назви правил в `.n-cursor.json` — ті самі (kebab-case)
- Назви скілів в `.n-cursor.json` — ті самі
- `SKILL.md` як ім'я файла маніфесту скіла — конвенція Cursor/Claude, лишається
- Публічне API CLI (`npx @nitra/cursor check`, `lint-ga` тощо) — без змін
