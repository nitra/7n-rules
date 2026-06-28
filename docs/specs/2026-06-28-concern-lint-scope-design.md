# Spec: concern-рівневий lint-scope і уніфікація concern-моделі

**Дата:** 2026-06-28
**Статус:** Draft
**Тип:** Breaking — змінює структуру `rules/<id>/`, схему `main.json`, контракт оркестратора; без зворотної сумісності

**Пов'язані документи:**

- `docs/specs/2026-05-15-npm-rules-concern-and-target-design.md` — перший варіант concern-моделі (JS + policy/target.json); ця спека **замінює** схему `target.json` і скасовує обгортку `policy/`
- `docs/specs/2026-05-31-rule-meta-json-design.md` — `main.json.auto` і поля rule-рівня; ця спека прибирає з `main.json` поля `lint` і `llmFix`
- `docs/specs/2026-06-14-lint-orchestrator-fix-readonly-unification-design.md` — вісь поведінки fix/read-only; тут лише вісь scope

---

## Проблема

`main.json.lint` — скалярне поле (`"per-file"` | `"full"`), яке задає **один scope на ціле правило**. Але правило є доменною групою і може мати concerns із різними scopes:

- `js/eslint` — per-file (ESLint по змінених файлах)
- `js/knip` — full (мертві exports потребують цілого репо)

Зараз обидва concerns мусять вміститись в одну `main.mjs::lint()` з одним scope. Розв'язок — перенести scope на рівень concern.

Паралельна проблема: `policy/<name>/target.json` — окремий JSON-файл із targeting-метаданими поряд із `concern.json`-маркером якого ще не існує. Два JSON на один concern.

---

## Рішення

### 1. Concern-каталог як одиниця

Будь-який **плоский підкаталог** у `rules/<id>/` із файлом `concern.json` = concern. Маркер `concern.json` замінює і `main.json.lint` (для lint-concerns), і `target.json` (для policy-concerns).

```
rules/js/
  main.json                  ← { "auto": {...} }  — тільки activation, worktree, requireRoot
  main.mdc
  js/                        ← helper modules (не concern — немає concern.json)
  eslint/
    concern.json             ← lint concern
    main.mjs
  knip/
    concern.json             ← lint concern
    main.mjs
  jscpd/
    concern.json             ← policy concern
    jscpd.rego
    jscpd_test.rego
    template/
    jscpd.mdc
  lint_js_yml/
    concern.json             ← policy concern
    lint_js_yml.rego
    lint_js_yml_test.rego
    target.json              ← ВИДАЛЯЄТЬСЯ (поля переходять у concern.json)
    template/
  package_json/
    concern.json
    package_json.rego
    ...
  vscode_extensions/
    concern.json
    ...
```

Каталоги без `concern.json` (`js/`, `lib/`, `docs/`, `coverage/`, `policy/`) — не concerns, оркестратор їх ігнорує.

### 2. `concern.json` — схема

Дискримінант між типами — набір полів: `scope` → lint-concern, `files` → policy-concern.

**Lint concern:**

```json
{
  "scope": "per-file",
  "glob": ["**/*.ts", "**/*.mjs"],
  "llmFix": true
}
```

| поле | обов'язковість | значення |
|---|---|---|
| `scope` | required | `"per-file"` — детектор декомпозується на changed-set; `"full"` — крос-файловий |
| `glob` | optional | per-file: фільтр файлів із delta, які передаються в `lint()`; full: delta-тригер — concern запускається лише якщо glob ∩ changed ≠ ∅ |
| `llmFix` | optional | `true` — concern opt-in у opportunistic LLM-fix (переїхав із `main.json`) |

**Policy concern:**

```json
{
  "files": { "single": ".jscpd.json", "required": true }
}
```

```json
{
  "files": { "walkGlob": "**/package.json" }
}
```

| поле | обов'язковість | значення |
|---|---|---|
| `files.single` | один із двох | шлях до конкретного файлу |
| `files.walkGlob` | один із двох | glob для обходу дерева |
| `files.required` | optional | `true` — файл обов'язковий (default: `false`) |

### 3. `main.json` після міграції

Видаляються поля `lint` і `llmFix` — вони переходять у `concern.json`. Залишаються rule-level поля:

```json
{ "auto": { "glob": ["**/*.mjs"] }, "worktree": true, "requireRoot": true }
```

### 4. `policy/` обгортка

Директорія `policy/` зникає. Колишні `policy/<name>/` стають `<name>/` у корені правила. `target.json` видаляється — його поля інтегруються в `concern.json`.

---

## Поведінка оркестратора

Discovery: сканувати `rules/<id>/` для підкаталогів із `concern.json`; читати тип за дискримінантом.

### Lint concern — `main.mjs::lint(changed, cwd, opts)`

| scope | mode | `changed` у lint() | умова запуску |
|---|---|---|---|
| `per-file` | delta | файли з delta, відфільтровані `concern.glob` | є delta |
| `per-file` | `--full` | `undefined` | завжди |
| `full` | `--full` | `undefined` | завжди |
| `full` | delta | `undefined` (whole-repo) | `concern.glob` ∩ delta ≠ ∅ |

`opts`: `{ readOnly, llmFix }` — як зараз.

### Policy concern

Поведінка незмінна — `conftest` за `files`-targeting. Оркестратор читає `files` із `concern.json` замість `target.json`.

---

## Міграція

### `main.json` — прибрати `lint` і `llmFix` (14 правил)

| правило | було | після |
|---|---|---|
| `doc-files` | `{ "lint": "per-file", "llmFix": true }` | `{}` |
| `js`, `security`, `style`, `text` | `{ "lint": "per-file" }` | `{}` |
| `bun`, `docker`, `ga`, `image-compress`, `k8s`, `php`, `python`, `rego`, `rust` | `{ "lint": "full" }` | `{}` |

### Нові lint-concern підкаталоги (14 правил)

Правила з одним поточним lint-concern: один підкаталог із іменем за логікою перевірки.

| правило | concern | scope | llmFix | glob |
|---|---|---|---|---|
| `doc-files` | `check/` | per-file | ✓ | — |
| `js` | `eslint/` | per-file | — | `**/*.{js,mjs,cjs,ts,tsx}` |
| `security` | `scan/` | per-file | — | — |
| `style` | `lint/` | per-file | — | `**/*.{css,scss,vue}` |
| `text` | `check/` | per-file | — | — |
| `bun` | `check/` | full | — | `package.json` |
| `docker` | `check/` | full | — | `**/Dockerfile*` |
| `ga` | `workflows/` | full | — | `.github/workflows/**` |
| `image-compress` | `check/` | full | — | `**/*.{jpg,png,svg}` |
| `k8s` | `manifests/` | full | — | `k8s/**/*.yaml` |
| `php` | `check/` | full | — | `**/*.php` |
| `python` | `check/` | full | — | `**/*.py` |
| `rego` | `check/` | full | — | `**/*.rego` |
| `rust` | `check/` | full | — | `**/*.rs` |

### `policy/<name>/` → `<name>/` + `concern.json` (всі правила з policy)

`target.json` у кожному concern видаляється; поля `files` переїжджають у `concern.json`.

Правила з policy: `abie`, `adr`, `bun`, `capacitor`, `ci4`, `docker`, `efes`, `ga`, `graphql`, `hasura`, `image-avif`, `image-compress`, `js`, `js-bun-db`, `js-bun-redis`, `js-mssql`, `js-run`, `k8s`, `nginx-default-tpl`, `npm-module`, `php`, `python`, `rego`, `rust`, `security`, `style`, `tauri`, `test`, `text`, `vue`, `worktree` — всього 31.

---

## Валідація схеми

`npm-module` перевіряє структуру правил (`js/rule_meta.mjs`). Після міграції додати перевірки:

- кожен підкаталог у `rules/<id>/` або має `concern.json`, або є в allowlist non-concern dirs (`js/`, `lib/`, `docs/`, `coverage/`, `policy/` — але `policy/` зникає)
- `concern.json` має або `scope`, або `files` — не обидва, не жодного
- якщо `scope` є `"full"` і `glob` відсутній у delta-режимі — concern не запускається (попередження при розробці)

---

## Не в цій спеці

- **Конкретні нові lint-concerns для `js`** (knip, type-check тощо) — наступна задача після міграції
- **Вісь поведінки fix/read-only** — `2026-06-14-lint-orchestrator-fix-readonly-unification-design.md`
- **LLM-fix деталі** — `2026-06-15-opportunistic-llm-fix-tier.md`
