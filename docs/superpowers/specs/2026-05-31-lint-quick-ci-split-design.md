# Spec: Розділення lint на `lint` (quick) / `lint-ci` (full) через meta.json

**Дата:** 2026-05-31
**Статус:** Approved (E1 — узгоджено в brainstorming)

---

## Проблема

Поточний `bun run lint` — монолітний ланцюг із 6 під-лінтів (`lint-ga`, `lint-js`, `lint-rego`, `lint-security`, `lint-style`, `lint-text`) + `oxfmt`, що ганяється цілком і локально, і в CI. Важкі крос-файлові аналізатори (jscpd, knip, trufflehog) мають сенс лише по всьому репо; агенту під час розробки треба **лише причесати власні зміни**.

Мета (рішення **E1**, data-driven у дусі Spec B): розщеплення на **`lint`** (швидкий, по змінених) і **`lint-ci`** (повний, по всіх) через **одне** поле `lint` у `rules/*/meta.json`; виконавець кроку — `js/lint.mjs` правила.

---

## Конвенція назв

| Скрипт | Призначення | Scope |
|---|---|---|
| `bun run lint` | швидка перевірка поточних змін (розробка, агент) | working-tree зміни проти HEAD + untracked |
| `bun run lint-ci` | повна перевірка | весь проєкт |

Обидва роблять `--fix`, де інструмент підтримує (рішення H1). Семантика наборів: **quick ⊆ ci**.

---

## meta.json — одне поле `lint` (E1)

`npm/rules/<id>/meta.json` отримує опціональне поле `lint`:

```json
{ "auto": "...", "lint": "quick" }
```

| Значення | Входить у `lint` | Входить у `lint-ci` |
|---|---|---|
| `"quick"` | ✅ (по змінених) | ✅ (по всіх) |
| `"ci"` | ❌ | ✅ |
| відсутнє | ❌ | ❌ (правило не є lint-кроком) |

**Свідомо НЕ вводимо** додаткових полів (`lintCmd`/`lintScoped`/`lintAlways`/`lintCiCmd`) — уся логіка кроку (яка команда, чи приймає файли, чи фільтрувати) інкапсульована у `js/lint.mjs` правила. Це тримає `meta.json` мінімальним (як `auto`) і дзеркалить підхід Spec B.

---

## Виконавець на боці правила: `js/lint.mjs`

Кожне правило-lint-крок додає `npm/rules/<id>/js/lint.mjs`:

```js
/**
 * @param {string[] | undefined} files
 *   string[] — quick-режим: лінтити лише ці файли (оркестратор передав змінені);
 *   undefined — ci-режим: увесь проєкт.
 * @returns {Promise<number>} exit code (0 — OK, ≠0 — порушення)
 */
export async function lint(files) { ... }
```

- Правило **саме** фільтрує `files` за релевантним розширенням (`.js/.ts/.vue/.css`…). Оркестратор передає **весь** список змінених — повний контроль у правила, без glob-конфігу в meta.
- Якщо після фільтра порожньо (quick) — `lint.mjs` повертає 0 (крок ефективно пропущено).
- Автофікс (`--fix`) увімкнений в обох режимах (H1).
- Інструменти, що **не вміють** per-file (jscpd, knip, trufflehog), у quick ігнорують `files` і просто не належать до `quick`-правил — вони `ci`.

---

## Розщеплення js-lint (D3)

`js-lint` — єдиний composite-крок: oxlint/eslint (quick) + jscpd/knip (ci). Розділяємо на **два правила**:

| Правило | `meta.json.lint` | `js/lint.mjs` виконує |
|---|---|---|
| `js-lint` | `"quick"` | `oxlint --fix [files]` + `eslint --fix [files]` |
| `js-lint-ci` | `"ci"` | `jscpd .` + `knip --no-config-hints` (ігнорує `files`) |

`npm/rules/js-lint-ci/` — нова папка (mdc + meta.json + js/lint.mjs). У `lint-ci` оркестратор виконує спершу quick-правила (зокрема `js-lint`), потім ci-правила (зокрема `js-lint-ci`).

---

## Класифікація кроків

| Правило | `lint` | per-file? | примітка |
|---|---|:---:|---|
| `js-lint` | `quick` | так | oxlint+eslint приймають список файлів |
| `style-lint` | `quick` | так | stylelint по глобу/файлах |
| `oxfmt` | `quick` | так | формат по файлах |
| `text` | `quick` | звірити | cspell/shellcheck — якщо не приймає files → `ci` |
| `js-lint-ci` | `ci` | ні | jscpd+knip (крос-файл) |
| `ga` | `ci` | ні | actionlint/zizmor сканують весь `.github/workflows/`, reusable workflows контекст-залежні |
| `rego` | `ci` | ні | conftest/regal валідує глобальний набір полісі |
| `security` | `ci` | ні | trufflehog — повний скан репо |

> Точна фаза `text` (чи його CLI `lint-text` приймає список файлів) — **звірити при імплементації**; якщо ні → `ci`. Аналогічно для `oxfmt` (де живе крок: окреме правило чи частина іншого) — уточнити при impl.
>
> `adr`, `bun`, `npm-module`, `worktree` тощо — поле `lint` відсутнє (не lint-кроки).

---

## CLI-оркестратор `n-cursor lint` / `n-cursor lint-ci`

Нові підкоманди в `npm/bin/n-cursor.js` (через `npm/scripts/lint-cli.mjs`).

**`n-cursor lint` (quick):**

1. `collectChangedFiles(cwd)` — `git diff HEAD --name-only --diff-filter=ACMR` + `git ls-files --others --exclude-standard` → relative-posix список.
2. Якщо список порожній → exit 0 (нічого перевіряти).
3. Скан `rules/*/meta.json`, взяти правила з `lint === "quick"` у **стабільному** порядку (алфавіт або зафіксований, як LINT_SCRIPTS).
4. Для кожного **послідовно** (заборона паралельного eslint — `CLAUDE.md`):
   - `import(rules/<id>/js/lint.mjs)` → `await lint(changedFiles)`;
   - **fail-fast**: перший ненульовий exit-код зупиняє прогін (як наявний `run-lint-cli.mjs`).
5. Ненульовий сумарний код → exit 1.

**`n-cursor lint-ci` (full):**

1. Скан `rules/*/meta.json`, взяти правила з `lint === "quick" || lint === "ci"`; порядок — quick перед ci.
2. Для кожного **послідовно**: `await lint(undefined)` (весь репо).
3. Ненульовий код → exit 1.

**Технічно:** виконання зовнішніх інструментів — `spawnSync` (без `shell: true`); строго послідовно (жодного `Promise.all`); за потреби — наявний `withLock` для серіалізації між процесами.

---

## Заборона паралельного запуску

`eslint`/`oxlint` **не запускати паралельно** — ні між кроками, ні в кількох процесах (`CLAUDE.md`). Оркестратор виконує кроки строго послідовно. Implementation plan **не** розбиває lint-кроки на паралельні субагенти.

---

## Схема `rule-meta.json` — розширення (мінімальне)

Додати **одне** поле:

```json
{
  "properties": {
    "lint": { "type": "string", "enum": ["quick", "ci"] }
  }
}
```

(жодних `lintCmd`/`lintScoped`/… — E1).

---

## Валідація: концерн у правилі `js-lint` (або `npm-module`)

Розширити наявний check (дзеркало `rule_meta.mjs`):

- якщо `meta.json.lint` присутнє → значення ∈ `{quick, ci}` і існує `npm/rules/<id>/js/lint.mjs` з експортом `lint`;
- навпаки: правило з `js/lint.mjs` повинно мати `lint`-поле (інакше крок «осиротів» — не потрапляє в жоден набір).

---

## Кореневий package.json (мігрує через sync, не руками)

Канонічні скрипти (задає правило `n-js-lint` / нове `lint`-правило):

```json
"lint":    "n-cursor lint",
"lint-ci": "n-cursor lint-ci"
```

Старі `lint-ga`/`lint-js`/`lint-rego`/`lint-security`/`lint-style`/`lint-text` стають внутрішньою деталлю `lint.mjs` кожного правила; їх видалення з кореневого `package.json` — через `npx @nitra/cursor` sync (НЕ в цьому spec руками).

---

## Тестування

- `lint-cli.test.mjs` — оркестратор: mock-набір meta.json → quick-набір = `lint:"quick"`, ci-набір = обидва; порожній changed-list → exit 0.
- `changed-files.test.mjs` — `collectChangedFiles` на tmp git-репо (`withTmpDir`+`git init`): diff HEAD + untracked.
- per-rule `lint.mjs` тести: quick (передати список файлів) і ci (undefined); фільтрація за розширенням.
- Регресія: `lint-ci` на чистому дереві = той самий результат, що поточний `bun run lint`.
- Повний `npm` сюїт зелений.

---

## Поетапна реалізація (для writing-plans)

1. `rule-meta.mjs` парсер + `rule-meta.json` схема — додати поле `lint` (enum quick/ci).
2. `npm/scripts/lib/changed-files.mjs` — `collectChangedFiles` (+тест).
3. `npm/scripts/lint-cli.mjs` — оркестратор `runLint({ci})` (+тест).
4. `js/lint.mjs` для кожного quick-правила: `js-lint` (oxlint+eslint), `style-lint`, `text`/`oxfmt` (за класифікацією).
5. `js-lint-ci` правило (нова папка) — `js/lint.mjs` (jscpd+knip), `meta.json` `lint:"ci"`.
6. `lint`-поле в `meta.json`: js-lint, js-lint-ci, style-lint, ga, rego, security, text (+oxfmt).
7. `n-cursor.js` — `case 'lint'` / `case 'lint-ci'`.
8. Валідація-концерн (lint↔lint.mjs) + оновлення `n-js-lint` канону кореневих скриптів.
9. Тести, регресія, change-файл.

---

## Поза scope

- Міграція кореневого `package.json` цього/споживацьких репо — через sync.
- Зміни GitHub workflow (CI кличе `lint-ci`) — окремо.
- 5-польова data-as-config схема (`lintCmd`/`lintScoped`/`lintAlways`/`lintCiCmd`) — **свідомо відкинута** на користь E1 (одне поле + `lint.mjs`-виконавець); якщо колись знадобиться декларативна команда в meta — окремий spec.
- Інкрементальний кеш — YAGNI.
