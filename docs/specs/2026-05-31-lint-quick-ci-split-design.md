# Spec: Розділення lint на quick і all через meta.json

**Дата:** 2026-05-31  
**Статус:** Draft

---

## Проблема

Поточний `bun run lint` запускає шість lint-кроків (oxlint, eslint, jscpd, knip, stylelint, trufflehog та ін.) щоразу — і під час розробки, і в CI. Повний прогін займає значний час; розробнику достатньо швидких перевірок лише по змінених файлах, а важкі крос-файлові аналізатори (jscpd, knip) мають сенс лише для повного прогону.

---

## Цілі

- `bun run lint-quick` — швидкий прогін лише по змінених файлах (`git diff --name-only HEAD`), придатний для виклику під час розробки.
- `bun run lint-all` — повний прогін (quick + ci-only набір) по всьому репо, для CI-пайплайну або повної локальної перевірки.
- Набір кроків у кожній фазі визначається **декларативно** через поля `lint`, `lintCmd`, `lintScoped`, `lintAlways`, `lintCiCmd` у `meta.json` правила — так само, як автодетект визначається полем `auto`.
- Скрипт `lint` і окремі `lint-ga`, `lint-js`, `lint-rego`, `lint-style`, `lint-text` — **лишаються незмінними** (backward-compat з існуючими споживачами).

---

## Не в цьому spec

- Міграція package.json споживачів (видалення старих `lint-ga`, `lint-js` і т.д.) — окрема задача після готовності CLI.
- Зміни в CI-конфігурації (`.github/workflows/`) — окремий крок.

---

## Критичне обмеження: заборона паралельного запуску

**eslint/oxlint/lint НЕ можна запускати паралельно** — ні між собою в межах одного прогону, ні одночасно в кількох процесах/агентах/shell-сесіях.

**Причина:** конкурентний eslint перевантажує диск і CPU, призводить до некоректних результатів і нестабільного виконання. Це зафіксовано в `CLAUDE.md` проєкту.

**Вимоги:**

- Обидва виконавці (`n-cursor lint-quick` і `n-cursor lint-all`) запускають кроки **строго послідовно**.
- При написанні implementation plan: `lint-quick`/`lint-all` **не розбиваються на паралельні субагенти**.

---

## Нові поля у `meta.json` правила

До наявного поля `auto` додаються lint-поля (всі необовʼязкові):

```json
{
  "lint": "quick", // "quick" або "ci" (quick ⊆ all)
  "lintCmd": "n-cursor lint-ga", // команда для виконання
  "lintScoped": false, // true → команда приймає список файлів як positional args
  "lintAlways": false, // true → запускати навіть якщо нема змінених файлів
  "lintCiCmd": "bunx jscpd . && bunx knip --no-config-hints" // лише для js-lint: ci-only команда
}
```

### Семантика полів

| Поле         | Тип               | Значення за замовчуванням | Опис                                                      |
| ------------ | ----------------- | ------------------------- | --------------------------------------------------------- |
| `lint`       | `"quick" \| "ci"` | відсутнє                  | Фаза. Відсутнє = правило не є lint-кроком                 |
| `lintCmd`    | `string`          | —                         | Команда для quick (і повного) прогону                     |
| `lintScoped` | `boolean`         | `false`                   | Передавати список змінених файлів як positional аргументи |
| `lintAlways` | `boolean`         | `false`                   | Не пропускати крок навіть якщо нема змінених файлів       |
| `lintCiCmd`  | `string`          | —                         | Додаткова ci-only команда (виконується лише в `lint-all`) |

### Семантика оркестратора при `lintScoped`

| `lintScoped` | Режим quick (`lint-quick`)                                                                             | Режим all (`lint-all`)                    |
| ------------ | ------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| `true`       | git diff → передає файли: `{lintCmd} file1 file2...`; якщо нема → пропустити (крім `lintAlways: true`) | запускає `lintCmd` без файлів (весь репо) |
| `false`      | запускає `lintCmd` без аргументів                                                                      | запускає `lintCmd` без аргументів         |

---

## Класифікація lint-кроків

| Правило        | `lint`       | `lintScoped` | `lintAlways` | `lintCiCmd`                                   |
| -------------- | ------------ | ------------ | ------------ | --------------------------------------------- |
| `ga`           | `ci`         | `false`      | `false`      | —                                             |
| `js-lint`      | `quick`      | `true`       | `false`      | `bunx jscpd . && bunx knip --no-config-hints` |
| `oxfmt` (нове) | `quick`      | `true`       | `false`      | —                                             |
| `rego`         | `quick`      | `true`       | `false`      | —                                             |
| `style-lint`   | `quick`      | `true`       | `false`      | —                                             |
| `text`         | `quick`      | `false`      | `false`      | —                                             |
| `security`     | **відсутнє** | —            | —            | —                                             |

**Примітки:**

- `security` (trufflehog) — **поза оркестратором**: власний CI job, власний скрипт `lint-security`. Ні в `lint-quick`, ні в `lint-all`.
- `ga` — **тільки `ci`**: workflows у `.github/` є самодостатнім контекстом, reusable workflows посилаються одне на одне — скопування по змінених файлах некоректне. Немає сенсу запускати при звичайній розробці.
- `lint-all` є **швидшим** за поточний `lint` (не включає trufflehog, який зараз у ланцюгу). `lint-all` = всі orchestrated правила; `security` — окремо.
- `js-lint` — єдиний composite-крок, що містить quick (oxlint+eslint) і ci (jscpd+knip) інструменти. Ci-частина виражена через `lintCiCmd`.
- `lintCmd` для `js-lint` — нова CLI-підкоманда `n-cursor lint-js [files...]`, що внутрішньо запускає `bunx oxlint --fix` і `bunx eslint --fix` з переданим списком файлів. (Compound-команда потребує wrapper-а, бо positional args не можна вставити в `&&`-рядок.)

---

## Нові правила та файли

### Правило `lint` (`npm/rules/lint/`)

Нове «конвенційне» правило (аналог `worktree` для worktree-конвенції):

- `npm/rules/lint/lint.mdc` — документує всю lint-конвенцію: що означають `lint-quick`/`lint-all`, які поля вимагаються в `meta.json` для lint-кроків, заборона паралельного запуску.
- `npm/rules/lint/meta.json` — `{ "auto": "завжди" }` (само правило не є lint-кроком; `check-lint.mjs` валідує інших).
- `npm/rules/lint/check-lint.mjs` — валідує lint-поля у **всіх** правилах репо: якщо є `lint`, то `lintCmd` обовʼязковий; невалідні значення відхиляти; перевіряти узгодженість з `rule-meta.json` схемою.

### Правило `oxfmt` (`npm/rules/oxfmt/`)

Нове правило для форматера (поточний `oxfmt .` у lint-ланцюгу):

- `npm/rules/oxfmt/oxfmt.mdc` — документує конвенцію: використовуємо `oxfmt` для форматування JS/TS/Vue.
- `npm/rules/oxfmt/meta.json` — `{ "lint": "quick", "lintCmd": "oxfmt", "lintScoped": true }`.

---

## CLI-оркестратор: `n-cursor lint-quick` / `n-cursor lint-all`

**Алгоритм `n-cursor lint-quick`:**

1. Зчитати `rules/*/meta.json`, зібрати правила з `lint: "quick"` → відсортувати за ID (алфавітно).
2. `git diff --name-only HEAD` → список змінених файлів.
3. Для кожного кроку послідовно:
   - `lintScoped: true` → передати список файлів як args; якщо нема файлів і `lintAlways: false` → пропустити.
   - `lintScoped: false` → запустити `lintCmd` без аргументів.
   - Якщо вихідний код ≠ 0 → зупинити (fail-fast).
4. `lintCiCmd` **не** виконується в quick-режимі.

**Алгоритм `n-cursor lint-all`:**

1. Зібрати всі правила з `lint` (і `quick`, і `ci`) → той самий алфавітний порядок.
2. Для кожного кроку:
   - Запустити `lintCmd` без фільтрації (весь репо).
   - Якщо є `lintCiCmd` → запустити і його.
   - Fail-fast при помилці.

**Технічні деталі:**

- Виконання — `execa`/`spawnSync` (не `shell: true`), безпечно щодо shell injection.
- Строго послідовно — жодного `Promise.all` чи worker-threads для lint-кроків.
- Реєструється у командному реєстрі пакета поряд з існуючими підкомандами.

---

## Зміни в `package.json` проєктів

Тільки **додаємо** нові скрипти, нічого не видаляємо і не змінюємо:

```json
{
  "lint": "<поточний ланцюг — незмінний>",
  "lint-quick": "n-cursor lint-quick",
  "lint-all": "n-cursor lint-all",
  "lint-ga": "<незмінний>",
  "lint-js": "<незмінний>",
  "lint-rego": "<незмінний>",
  "lint-security": "<незмінний>",
  "lint-style": "<незмінний>",
  "lint-text": "<незмінний>"
}
```

---

## Оновлення правила `n-js-lint`

- `n-js-lint.mdc` — посилається на `lint.mdc` для загальної lint-конвенції; сам документує JS-специфіку (вибір oxlint/eslint, конфіги, `lintCiCmd` для jscpd+knip).
- `check-js-lint.mjs` — оновлення: перевіряти наявність `lint-quick` і `lint-all` у `scripts` (як нові обовʼязкові); поточні `lint-js` і `lint` — лишаються валідними.

---

## Схема `rule-meta.json` — розширення

Додаємо нові поля до існуючої схеми:

```json
{
  "properties": {
    "lint": { "type": "string", "enum": ["quick", "ci"] },
    "lintCmd": { "type": "string" },
    "lintScoped": { "type": "boolean", "default": false },
    "lintAlways": { "type": "boolean", "default": false },
    "lintCiCmd": { "type": "string" }
  },
  "dependentRequired": {
    "lintCmd": ["lint"],
    "lintScoped": ["lint"],
    "lintAlways": ["lint"],
    "lintCiCmd": ["lint"]
  }
}
```

---

## Тестування

- **Юніт-тести оркестратора** `lint-orchestrator.test.mjs`:
  - Парсинг meta.json → правильний набір quick vs all кроків.
  - `lintScoped: true` → команда отримує список файлів; пустий список → пропуск.
  - `lintAlways: true` → крок виконується навіть без файлів.
  - `lintCiCmd` → виконується лише в `lint-all`.
- **Юніт-тести lint-js wrapper** `lint-js.test.mjs`: oxlint + eslint отримують правильний file-list.
- **Інтеграційний тест**: `n-cursor lint-quick` і `n-cursor lint-all` з відомими зміненими файлами → перевірити які кроки запустились.

---

## Поетапна реалізація (орієнтир для writing-plans)

1. **Схема** — розширити `rule-meta.json` новими полями.
2. **lint.mdc + check-lint.mjs** — нове конвенційне правило.
3. **meta.json правил** — додати lint-поля до `ga`, `js-lint`, `rego`, `style-lint`, `text`.
4. **oxfmt правило** — `npm/rules/oxfmt/` (mdc + meta.json).
5. **lint-js wrapper** — `n-cursor lint-js [files...]` CLI-підкоманда.
6. **Оркестратор** — `n-cursor lint-quick` і `n-cursor lint-all`.
7. **package.json** — додати `lint-quick` і `lint-all` скрипти.
8. **n-js-lint оновлення** — `n-js-lint.mdc` і `check-js-lint.mjs`.
9. **Тести** + регресія + change-файл.
