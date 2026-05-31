# Template Directory для правил `npm/rules/<id>/`

**Дата:** 2026-05-17 (оновлено)
**Статус:** ЗАТВЕРДЖЕНО

---

## Проблема

Правила в `npm/rules/<id>/` поєднують у `.mdc` файлі дві логічно різні речі:

1. **AI-директиви** — що і як генерувати/редагувати.
2. **Фрагменти канону** — inline code blocks із вмістом цільових файлів.

Ці inline-блоки дублюються у `check.mjs` / `.rego` як hardcoded рядки/регекспи. Зміна канону потребує синхронного оновлення `.mdc` + `check.mjs` + `.rego`. Немає єдиного джерела правди.

---

## Scope

Покриваємо:

- **Merge-фрагменти** — частини, які вливаються в існуючий файл проєкту (один scripts entry у `package.json`, запис у `recommendations` у `.vscode/extensions.json`, pin версії у `devDependencies`, substring-присутність у агрегованому `lint`, заборона певних ключів).
- **Повні файли-канони** (`.gitleaks.toml`, повні workflow `.yml`, `.stylelintignore`) — теж у `template/`, у нативному форматі цільового файлу. AI читає файл напряму через посилання у `.mdc`. Семантика — та сама `.snippet` (subset-of): канон обов'язковий, проєкт може доповнити (наприклад додати свої `[allowlist]` patterns у `.gitleaks.toml`).

**НЕ покриваємо** (лишаються inline в `.mdc`):

- Параметризовані snippets з placeholder-ами (HTTPRoute з `<prefix>`, k8s-Deployment з `<service>/<namespace>`) — потребують template engine, окрема потреба.

---

## Рішення

Ввести каталог `template/` на рівні **концерну** (`fix/<concern>/template/` або `policy/<concern>/template/`) з трьома типами файлів — **у нативному форматі цільового файлу**:

| Файл                      | Семантика                                                                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<target>.snippet.<ext>`  | required: кожна leaf-пара має бути в реальному файлі з тим самим значенням; масиви — subset-of. Для повних канонів — увесь template є обов'язковою підмножиною |
| `<target>.deny.<ext>`     | forbidden: будь-який ключ цього дерева у реальному файлі = fail (значення = опис помилки)                                                                      |
| `<target>.contains.<ext>` | substring: рядкове поле реального файлу має містити кожен рядок масиву як substring                                                                            |

`<ext>` дорівнює розширенню цільового файлу (`.json`, `.toml`, `.yml`, `.yaml`, `.jsonc`). Loader парсить за extension у JS-object, далі — однотипне структурне порівняння. Для **text-only** цілей (`.stylelintignore`, plain config) `template/<target>` (без `.snippet.` суфікса) = subset-of-lines: кожен рядок template має бути присутнім у реальному файлі.

`<target>` — basename цільового файлу. Багаторівневі цілі (`.github/workflows/lint-security.yml`) розв'язуються через nested-dirs у template: `template/.github/workflows/lint-security.yml.snippet.yml`.

### Приклад — `security/policy/package_json/template/`

`package.json.snippet.json`:

```json
{ "scripts": { "lint-security": "gitleaks detect --no-banner" } }
```

`package.json.deny.json`:

```json
{
  "dependencies": { "gitleaks": "глобальний CLI — не додавай у dependencies" },
  "devDependencies": { "gitleaks": "глобальний CLI — не додавай у devDependencies" }
}
```

`package.json.contains.json`:

```json
{ "scripts": { "lint": ["bun run lint-security"] } }
```

### Приклад повного канону — `security/fix/gitleaks/template/.gitleaks.toml.snippet.toml`

```toml
title = "Project gitleaks config"

[extend]
useDefault = true

[allowlist]
description = "Файли й шляхи, які навмисно містять test-фікстури з паттернами секретів."
paths = [
  '''(^|/)node_modules(/|$)''',
  '''(^|/)\.git(/|$)''',
  '''(^|/)dist(/|$)''',
  '''(^|/)build(/|$)''',
  '''.*\.lock$''',
  '''.*fixtures?/.*'''
]
```

Loader парсить TOML у object, check переконується, що реальний `.gitleaks.toml` містить **щонайменше** ці поля (subset-of). Проєкт може доповнити `[allowlist]` своїми patterns — це OK.

---

## Layout

```
npm/rules/<id>/
├── <id>.mdc
├── fix/<concern>/
│   ├── check.mjs
│   ├── check.test.mjs
│   ├── target.json
│   └── template/                    ← ТІЛЬКИ якщо концерн існує без policy/
│       ├── <target>.snippet.json
│       ├── <target>.deny.json
│       └── <target>.contains.json
└── policy/<concern>/
    ├── <concern>.rego
    ├── <concern>_test.rego
    ├── target.json
    └── template/                    ← CANONICAL home
        ├── <target>.snippet.json
        ├── <target>.deny.json
        └── <target>.contains.json
```

**Canonical location**: `policy/<concern>/template/` за замовчуванням (Rego — primary validator). Якщо концерн існує тільки у `fix/<concern>/` (наприклад FS-only перевірка), template — у `fix/<concern>/template/`. Якщо обидва — JS читає relative: `../../policy/<concern>/template/<target>.snippet.json`.

**Glob цілі** (`walkGlob: "**/package.json"`): template застосовується до **кожного** матчу glob однаково.

**Non-JSON цільові формати** (`.toml`, `.yaml`, `.jsonc`): template файл — у тому ж форматі, що цільовий (`.snippet.toml`, `.snippet.yml`, `.snippet.jsonc`). Loader парсить за extension у JS-object — далі структурне порівняння. Це натуральніше для AI: фрагмент виглядає як цільовий файл, а не як його JSON-переклад.

**Text-only цільові формати** (`.stylelintignore`, `.v8rignore`, plain config): `template/<target>` без `.snippet.` суфікса. Семантика — subset-of-lines (кожен рядок template має бути присутнім у реальному файлі; порожні рядки і коментарі ігноруються).

---

## MDC-контракт

`.mdc` файл правила **зобов'язаний** містити markdown-посилання на кожен template-каталог правила:

```markdown
Канон фрагментів — `template/`:

- [package.json](./policy/package_json/template/package.json.snippet.json)
- [.vscode/extensions.json](./policy/vscode_extensions/template/.vscode/extensions.json.snippet.json)
```

Окремий централізований крок у CLI runner (`npm/scripts/utils/check-mdc-template-refs.mjs`) перевіряє для кожного правила:

- Кожен файл у будь-якому `template/` каталозі правила має markdown-посилання у `<id>.mdc`.
- Fail з конкретним шляхом, якщо новий template-файл забутий у `.mdc`.

Реалізація **не** дублюється як per-rule концерн (`fix/mdc_sync/` × 26) — це один scan, що пробігає всі rules з `template/` каталогами.

**Cursor / Claude Code** відкривають template-файл через Read tool при явному зверненні до шляху. Inline code block у `.mdc` лишається лише для повних канонів (категорія A, поза scope цього spec).

---

## Нові утиліти

### `npm/scripts/utils/template.mjs`

```js
/**
 * Reads template/ for a concern directory. Looks at policy/<concern>/template/
 * first (canonical), falls back to fix/<concern>/template/ for fix-only concerns.
 * @param {string} concernDir absolute path to fix/<concern>/ or policy/<concern>/
 * @returns {Promise<TemplateData>} merged tree per target: {[target]: {snippet, deny, contains}}
 */
export async function loadTemplate(concernDir)

/**
 * Returns violations (empty array if all pairs match).
 * Deep subset-of: every leaf in `required` must equal the same path in `actual`.
 * Arrays in required: every element must be present in actual array.
 */
export function checkSnippet(actual, snippet, opts)

/** Returns violations for any path in `deny` that exists in actual. */
export function checkDeny(actual, deny, opts)

/** Returns violations: each string in contains-arrays must be substring of leaf string in actual. */
export function checkContains(actual, contains, opts)
```

`opts`: `{ targetPath, source }` — для контекстних повідомлень помилок (`source: 'security.mdc'`).

### `npm/scripts/utils/run-conftest-batch.mjs` (доповнення)

Розширити сигнатуру `runConftestBatch`:

```js
runConftestBatch({
  policyDirRel: 'security/package_json',
  namespace: 'security.package_json',
  files: ['/abs/path/package.json'],
  templateData: { snippet: {...}, deny: {...}, contains: {...} },  // ← НОВЕ опціональне поле
})
```

Якщо `templateData` передано:

1. Серіалізувати у tmp JSON: `{ "template": { "snippet": ..., "deny": ..., "contains": ... } }`
2. Передати `conftest test ... --data <tmp.json>`
3. Cleanup tmp після завершення

Без `templateData` — поведінка без змін (зворотна сумісність).

---

## Rego data path

```rego
package security.package_json
import rego.v1

deny contains msg if {
  required := data.template.snippet.scripts["lint-security"]
  actual := object.get(input, ["scripts", "lint-security"], "")
  actual != required
  msg := sprintf("package.json: scripts.lint-security має бути %q (security.mdc)", [required])
}

deny contains msg if {
  some pkg, _ in data.template.deny.dependencies
  pkg in object.keys(object.get(input, "dependencies", {}))
  msg := sprintf("package.json: %q не повинен бути в dependencies (security.mdc)", [pkg])
}

deny contains msg if {
  needles := data.template.contains.scripts.lint
  some needle in needles
  not contains(object.get(input, ["scripts", "lint"], ""), needle)
  msg := sprintf("package.json: scripts.lint має містити %q (security.mdc)", [needle])
}
```

Namespace у `--data` — flat `{ "template": {...} }`, єдиний на conftest-виклик (один концерн = один виклик).

---

## Класифікація концернів

Перед міграцією — інвентаризація всіх ~50+ концернів у 26 правилах за категорією:

| Категорія                          | Опис                                                                                                   | Стратегія                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| **Template-eligible (fragment)**   | merge-фрагмент на single JSON/TOML/YAML/jsonc                                                          | `.snippet.<ext>` у нативному форматі                                      |
| **Template-eligible (full canon)** | повний файл-канон (`.gitleaks.toml`, workflow `.yml`, `.stylelintignore`)                              | `.snippet.<ext>` повного вмісту, або `<target>` без суфікса для text-only |
| **Partial**                        | FS-existence + leaf-перевірка                                                                          | FS лишається в JS, leaf → template                                        |
| **Non-eligible**                   | cross-file / kustomize-resolution / параметризовані snippets з placeholder-ами / file-walking з графом | лишається inline, з коментарем-обґрунтуванням                             |

Інвентаризація — частина Phase 0 deliverable.

---

## Поетапна реалізація

Один спільний branch / тематичний PR, але внутрішня послідовність:

1. **Phase 0** — інфраструктура: `template.mjs` (loader + check-функції), розширення `run-conftest-batch.mjs`, інвентаризація концернів за категорією. Без жодного перевіденого правила. Існуючий test-suite green.
2. **Phase 1** — pilot на `security` (одне правило: fix/gitleaks + policy/package_json). Валідує всю обв'язку end-to-end.
3. **Phase 2** — батч simple-JSON концернів (text._, js-lint.package_json, style-lint._, graphql.\*). Машинально, паралельно через subagent.
4. **Phase 3** — TOML/YAML/jsonc цілі та повні канони (security.gitleaks `.gitleaks.toml`, rego `.regal/config.yaml`, text.markdownlint `.markdownlint-cli2.jsonc`, повні workflow `.yml` для ga/k8s/docker/style-lint/security, `.stylelintignore`).
5. **Phase 4** — walkGlob прості (js-bun-redis, image-avif на `**/package.json`).
6. **Phase 5** — classify rest (k8s, abie, npm-module): або переписати, або лишити inline з ADR-обґрунтуванням.
7. **Phase 6** — оновити `.mdc`: прибрати inline merge-фрагменти, замінити на markdown-посилання на template. Активувати централізований mdc-template-refs check у runner.

---

## Тестова стратегія

- **`template.mjs`** — нові unit tests з fixture-template-trees (`__fixtures__/<scenario>/template/`, очікувані pass/fail).
- **`*_test.rego`** — мокують `data` через `with data as {...}`:
  ```rego
  test_lint_security_required if {
    msg := "package.json: scripts.lint-security має бути \"gitleaks detect --no-banner\" (security.mdc)"
    deny[msg] with
      input as {"scripts": {}} with
      data.template.snippet as {"scripts": {"lint-security": "gitleaks detect --no-banner"}}
  }
  ```
- **Existing `check.mjs` snapshot/integration tests** — переписуються паралельно з міграцією концерну.

---

## Сумісність та ризики

- **Зворотна сумісність**: `runConftestBatch` приймає `templateData` опційно — існуючі концерни без template продовжують працювати.
- **CLI публічний API** не змінюється (`.n-cursor.json`, `npx @nitra/cursor check`).
- `check.mjs` сигнатура змінюється: `check()` → `check({ template })`. CLI orchestrator адаптується одночасно.

| Ризик                                                               | Мітигація                                                                                     |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Дрифт template ↔ inline-snippets у `.mdc`                           | Phase 6 + `fix/mdc_sync/` як страховка                                                        |
| Concern класифіковано як template-eligible, але виявляється partial | Phase 1 на pilot ловить; per-rule code review проти class-table                               |
| Subagent batch-міграція в Phase 2 пропускає edge-case               | Окремий commit per rule — можна re-review                                                     |
| Rego звертається до `data.template.*` коли template не передано     | conftest повертає undefined без падіння; rego-правила формулюємо з `object.get(...)` defaults |

---

## Альтернативи, що відхилені

| Альтернатива                                                   | Причина відхилення                                                                                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Rule-level `template/` (один на правило)                       | Collision: k8s має 4 концерни на `*.yaml`, npm-module — 2 на `package.json`                                                          |
| DSL-файл `check.json` з ключами required/forbidden/contains    | Новий синтаксис, AI треба вчити; native fragments — natural, AI читає як цільовий файл                                               |
| Expectations DSL у YAML (`expectations.yaml`)                  | Те саме — новий синтаксис, не схоже на цільовий файл                                                                                 |
| Snippet-only (без deny/contains)                               | Contains-перевірки (`lint` містить `bun run lint-security`) і forbid не покриваються — лишається подвійна точка істини               |
| Сценарій A (scaffold-файли повних канонів) як окрема концепція | Уніфіковано в `.snippet.<ext>` — повний канон = subset-of, який покриває весь файл. AI читає template-файл через посилання у `.mdc`. |
| `@path` references у `.mdc`                                    | Claude Code не підтримує автоматичне розгортання `@path` всередині `.mdc`                                                            |
