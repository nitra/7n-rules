# Дизайн: реорганізація npm-пакету навколо директорій правил

**Дата:** 2026-05-14  
**Статус:** Затверджено

---

## 1. Контекст

Зараз файли одного правила (`.mdc`, `.rego`, `check-*.mjs`, `run-*.mjs`) розкидані по чотирьох каталогах:

| Де зараз | Що містить |
|---|---|
| `npm/mdc/` | 26 файлів `*.mdc` |
| `npm/policy/` | rego-поліси 24 правил (snake_case каталоги) |
| `npm/scripts/` | 25 `check-*.mjs` + 8 `run-*/lint-*` + 11 інфраструктурних |
| `npm/bin/auto-rules.md` | умови автоактивації всіх правил |

Видалити одне правило — означає вичищати 4 різні місця. Нова CI4-правило чи правило-видалення — ризик упустити файл.

---

## 2. Ціль

Одне правило = одна директорія в `npm/rules/{rule}/`. Видалення директорії — повна очистка правила без решток.

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

#### check-*.mjs (25 файлів)

| Було | Стане |
|---|---|
| `scripts/check-abie.mjs` | `rules/abie/js/check.mjs` |
| `scripts/check-adr.mjs` | `rules/adr/js/check.mjs` |
| `scripts/check-bun.mjs` | `rules/bun/js/check.mjs` |
| `scripts/check-capacitor.mjs` | `rules/capacitor/js/check.mjs` |
| `scripts/check-changelog.mjs` | `rules/changelog/js/check.mjs` |
| `scripts/check-docker.mjs` | `rules/docker/js/check.mjs` |
| `scripts/check-ga.mjs` | `rules/ga/js/check.mjs` |
| `scripts/check-graphql.mjs` | `rules/graphql/js/check.mjs` |
| `scripts/check-hasura.mjs` | `rules/hasura/js/check.mjs` |
| `scripts/check-image-avif.mjs` | `rules/image-avif/js/check.mjs` |
| `scripts/check-image-compress.mjs` | `rules/image-compress/js/check.mjs` |
| `scripts/check-js-bun-db.mjs` | `rules/js-bun-db/js/check.mjs` |
| `scripts/check-js-bun-redis.mjs` | `rules/js-bun-redis/js/check.mjs` |
| `scripts/check-js-lint.mjs` | `rules/js-lint/js/check.mjs` |
| `scripts/check-js-mssql.mjs` | `rules/js-mssql/js/check.mjs` |
| `scripts/check-js-run.mjs` | `rules/js-run/js/check.mjs` |
| `scripts/check-k8s.mjs` | `rules/k8s/js/check.mjs` |
| `scripts/check-nginx-default-tpl.mjs` | `rules/nginx-default-tpl/js/check.mjs` |
| `scripts/check-npm-module.mjs` | `rules/npm-module/js/check.mjs` |
| `scripts/check-php.mjs` | `rules/php/js/check.mjs` |
| `scripts/check-rego.mjs` | `rules/rego/js/check.mjs` |
| `scripts/check-style-lint.mjs` | `rules/style-lint/js/check.mjs` |
| `scripts/check-tauri.mjs` | `rules/tauri/js/check.mjs` |
| `scripts/check-text.mjs` | `rules/text/js/check.mjs` |
| `scripts/check-vue.mjs` | `rules/vue/js/check.mjs` |

#### run-*/lint-* (8 файлів)

| Було | Стане |
|---|---|
| `scripts/lint-ga.mjs` | `rules/ga/js/lint.mjs` |
| `scripts/lint-rego.mjs` | `rules/rego/js/lint.mjs` |
| `scripts/run-docker.mjs` | `rules/docker/js/run.mjs` |
| `scripts/run-k8s.mjs` | `rules/k8s/js/run.mjs` |
| `scripts/run-php.mjs` | `rules/php/js/run.mjs` |
| `scripts/run-shellcheck-text.mjs` | `rules/text/js/run-shellcheck.mjs` |
| `scripts/run-v8r.mjs` | `rules/text/js/run-v8r.mjs` |

#### policy/ (24 директорії, snake_case → kebab-case)

| Було | Стане |
|---|---|
| `policy/abie/` | `rules/abie/policy/` |
| `policy/image_avif/` | `rules/image-avif/policy/` |
| `policy/image_compress/` | `rules/image-compress/policy/` |
| `policy/js_bun_db/` | `rules/js-bun-db/policy/` |
| `policy/nginx_default_tpl/` | `rules/nginx-default-tpl/policy/` |
| ... (решта — без snake→kebab конверсії) | ... |

### 3.4 `npm/scripts/` — залишається: лише інфраструктура

```
npm/scripts/
├── auto-rules.mjs           ← тепер читає rules/*/auto.md
├── auto-skills.mjs          ← тепер читає rules/*/auto.md (секцію ## Skills)
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

### 3.5 Формат `auto.md`

```markdown
# {rule} auto-config

## Rules

{rule} - [ glob: .github/workflows/*.{yml,yaml} ]

## Skills

n-abie-clean - [ abie ]
```

Синтаксис успадковує поточний з `auto-rules.md` та `auto-skills.md`.  
Якщо у правила немає умов автоактивації — розділ `## Rules` відсутній.  
Якщо немає пов'язаних skills — розділ `## Skills` відсутній.

### 3.6 `npm/skills/` — залишається без змін

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
- Читають усі `rules/*/auto.md`
- Парсять секцію `## Rules` і `## Skills`
- `bin/auto-rules.md` та `bin/auto-skills.md` **видаляються**

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

1. **Підготовка:** створити `npm/rules/` зі структурою директорій.
2. **Перемістити `.mdc`:** `npm/mdc/{rule}.mdc` → `npm/rules/{rule}/{rule}.mdc`.
3. **Перемістити `policy/`:** `npm/policy/{snake_rule}/` → `npm/rules/{rule}/policy/` (з конверсією snake→kebab).
4. **Перемістити check-*.mjs:** `npm/scripts/check-{rule}.mjs` → `npm/rules/{rule}/js/check.mjs`.
5. **Перемістити run-*/lint-*:** 7 файлів за маппінгом у п. 3.3.
6. **Створити `auto.md`** у кожній директорії правила (вирізати з `bin/auto-rules.md` + `bin/auto-skills.md`).
7. **Оновити `bin/n-cursor.js`:** нові шляхи, нова логіка readdir.
8. **Оновити `scripts/auto-rules.mjs`, `auto-skills.mjs`:** читати `rules/*/auto.md`.
9. **Оновити `scripts/lint-conftest.mjs`:** нові шляхи до `policy/`.
10. **Оновити `package.json#files`.**
11. **Видалити** `npm/mdc/`, `npm/policy/`, `bin/auto-rules.md`, `bin/auto-skills.md`.
12. **Запустити тести та `npx @nitra/cursor check`.**

---

## 8. Що не змінюється

- `npm/skills/` — структура залишається
- `npm/scripts/` — залишаються 11 спільних файлів + `utils/`
- Назви правил в `.n-cursor.json` — ті самі (kebab-case)
- Публічне API CLI (`npx @nitra/cursor check`, `lint-ga` тощо) — без змін
