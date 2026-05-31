# Spec: data-driven lint-split (quick / ci)

**Дата:** 2026-05-31  
**Статус:** Approved  

---

## Контекст

Поточний `bun run lint` — монолітний послідовний ланцюг із 6 під-лінтів (`lint-ga`, `lint-js`, `lint-rego`, `lint-security`, `lint-style`, `lint-text`) + `oxfmt`. Він важкий (jscpd, knip, trufflehog ганяються по всьому репо), а агенту локально треба **лише причесати власні зміни**. CI навпаки потребує повної перевірки.

Мета: data-driven розщеплення на **`lint`** (швидкий, по змінених) і **`lint-ci`** (повний, по всіх) через атрибут у `rules/*/meta.json` — в дусі Spec B (auto-rules meta-interpreter).

---

## Конвенція назв

| Скрипт | Призначення | Scope |
|---|---|---|
| `bun run lint` | швидка перевірка поточних змін | working-tree зміни проти HEAD + untracked |
| `bun run lint-ci` | повна CI-перевірка | весь проєкт |

Обидва роблять `--fix` там, де інструмент підтримує (H1).

---

## meta.json — нове поле `lint`

`npm/rules/<id>/meta.json` отримує опціональне поле:

```json
{ "auto": "...", "lint": "quick" }
```

| Значення | Входить у `lint` | Входить у `lint-ci` |
|---|---|---|
| `"quick"` | ✅ | ✅ |
| `"ci"` | ❌ | ✅ |
| відсутнє | ❌ | ❌ (правило не є lint-кроком) |

Семантика: quick ⊆ ci.

---

## Виконавець на боці правила: `js/lint.mjs`

Кожне правило, що є lint-кроком, додає файл `npm/rules/<id>/js/lint.mjs`:

```js
/**
 * @param {string[] | undefined} files
 *   string[] — quick-режим: лише ці файли
 *   undefined — ci-режим: увесь проєкт
 * @returns {Promise<void>} — throws / exits on lint error
 */
export async function lint(files) { ... }
```

- Якщо `files` — порожній масив (у змінених нема відповідних розширень) — крок **пропускається** (виклику `lint()` немає, не виконується).
- Автофікс (`--fix`) увімкнений в обох режимах.

---

## Розщеплення js-lint (D3)

`js-lint` — єдиний композитний крок: oxlint/eslint (quick) + jscpd/knip (ci). Вирішення: два окремих правила.

| Правило | `meta.json lint` | `js/lint.mjs` виконує |
|---|---|---|
| `js-lint` | `"quick"` | `oxlint --fix <files>` + `eslint --fix <files>` |
| `js-lint-ci` | `"ci"` | `jscpd .` + `knip` (files ігнорується) |

Папка `npm/rules/js-lint-ci/` — нова. Порядок у `lint-ci` оркестратора: спочатку quick-правила (у тому числі `js-lint`), потім ci-правила (у тому числі `js-lint-ci`).

---

## CLI-оркестратор

Нові команди `n-cursor lint` і `n-cursor lint-ci` у `npm/bin/`.

### `n-cursor lint` (quick)

1. `git diff HEAD --name-only --diff-filter=ACM` + untracked (`git ls-files --others --exclude-standard`) → `changedFiles: string[]`.
2. Якщо `changedFiles.length === 0` → exit 0 (нічого перевіряти).
3. Сканує `npm/rules/*/meta.json`, бере правила де `lint === "quick"`.
4. Для кожного правила (послідовно — заборона паралельних eslint):
   - фільтрує `changedFiles` за glob-шаблоном правила (поле `globs` у `meta.json` або `worktree.mdc`, TBD — або просто передає весь список, а `lint.mjs` фільтрує сам);
   - якщо filtered порожній — skip;
   - `await import(rulePath/js/lint.mjs)` → `lint(filteredFiles)`.
5. Якщо хоч один крок впав — exit 1.

### `n-cursor lint-ci` (full)

1. Сканує `npm/rules/*/meta.json`, бере правила де `lint === "quick" || lint === "ci"`.
2. Для кожного (послідовно): `lint(undefined)`.
3. Якщо хоч один впав — exit 1.

---

## Фільтрація файлів у quick

Оркестратор передає **весь список змінених файлів** у `lint(files)`, а відфільтрувати за розширенням (`.js`, `.ts`, `.vue`, `.css` тощо) — відповідальність `lint.mjs` правила. Це дає правилу повний контроль і не вимагає glob-конфігу на рівні meta.

---

## Кореневий package.json — після

```json
"lint":    "n-cursor lint",
"lint-ci": "n-cursor lint-ci"
```

Скрипти `lint-ga`, `lint-js`, `lint-rego`, `lint-security`, `lint-style`, `lint-text` **видаляються** (стають внутрішньою деталлю `lint.mjs` кожного правила).

---

## Правила та їх фаза

| Правило | `lint` | Інструменти |
|---|---|---|
| `js-lint` | `quick` | oxlint --fix, eslint --fix |
| `js-lint-ci` | `ci` | jscpd, knip |
| `style-lint` | `quick` | stylelint --fix |
| `ga` | `quick` | n-cursor lint-ga (shellcheck) |
| `rego` | `quick` | n-cursor lint-rego (OPA) |
| `text` | `quick` | n-cursor lint-text (vale/cspell) |
| `security` | `ci` | trufflehog (весь репо) |

`adr`, `bun`, `npm-module`, `worktree` тощо — `lint` відсутнє (не lint-кроки).

> Точна класифікація `ga`, `rego`, `text` (чи вони приймають список файлів) — перевіряється під час реалізації; якщо ні, переводяться в `ci`.

---

## Валідація schema

`npm/schemas/rule-meta.json` (вже існує після Spec B) оновлюється: поле `lint` — enum `["quick", "ci"]`, optional.

---

## Тестування

- Unit-тест оркестратора: mock `meta.json`, перевірити що quick-набір = правила з `lint:"quick"`, ci-набір = обидва.
- Unit-тест кожного `lint.mjs`: quick-режим (передати тестовий список файлів), ci-режим (undefined).
- Регресія: `bun run lint-ci` має дати той самий результат, що поточний `bun run lint` на чистому дереві.

---

## Зміни файлів

```
npm/
  rules/
    js-lint/
      meta.json            ← додати "lint": "quick"
      js/lint.mjs          ← новий (oxlint + eslint)
    js-lint-ci/            ← нова папка
      meta.json            ← "lint": "ci"
      js/lint.mjs          ← новий (jscpd + knip)
    style-lint/
      meta.json            ← "lint": "quick"
      js/lint.mjs          ← новий (stylelint)
    ga/
      meta.json            ← "lint": "quick"
      js/lint.mjs          ← новий (або делегує в n-cursor lint-ga)
    rego/
      meta.json            ← "lint": "quick"
      js/lint.mjs          ← новий
    text/
      meta.json            ← "lint": "quick"
      js/lint.mjs          ← новий
    security/
      meta.json            ← "lint": "ci"
      js/lint.mjs          ← новий (trufflehog)
    */meta.json            ← оновити схему (додати lint enum)
  schemas/rule-meta.json   ← додати lint enum
  bin/                     ← нові команди lint / lint-ci
  scripts/
    tests/                 ← тести оркестратора
package.json               ← lint → "n-cursor lint", lint-ci → "n-cursor lint-ci"
                              видалити lint-ga/js/rego/security/style/text скрипти
```

---

## Поза scope

- Паралельний запуск лінтерів — заборонено (CLAUDE.md); реалізація завжди послідовна.
- `lint-ci` у CI pipeline — конфіг CI не змінюється в цьому spec; CI викликає `bun run lint-ci`.
- Інкрементальний кеш (пропускати незмінені файли між запусками) — YAGNI, не зараз.
