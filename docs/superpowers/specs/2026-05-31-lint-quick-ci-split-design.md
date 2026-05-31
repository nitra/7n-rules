# Spec: Розділення lint на quick і CI-фази через meta.json

**Дата:** 2026-05-31  
**Статус:** Approved

---

## Проблема

Поточний `bun run lint` запускає шість lint-кроків (oxlint, eslint, jscpd, knip, stylelint, trufflehog та ін.) щоразу — і під час розробки, і в CI. Повний прогін займає значний час; розробнику достатньо швидких перевірок лише по поточних змінах логіки, а важкі крос-файлові аналізатори (jscpd, knip) мають сенс лише в CI.

---

## Цілі

- `bun run lint` — швидкий прогін (quick-набір), придатний для виклику в pre-commit і під час розробки.
- `bun run lint-ci` — повний прогін (quick + ci-only набір), для CI-пайплайну.
- Набір кроків у кожній фазі визначається **декларативно** через поле `lint` у `meta.json` правила — так само, як автодетект визначається полем `auto`.
- Жодного хардкоду списків інструментів у скриптах `package.json` напряму; скрипт делегує CLI-команді пакета.

---

## Не в цьому spec

- Фільтрація по змінених файлах (git diff scope) — можлива майбутня фіча, але не зараз.
- Зміни в CI-конфігурації (`.github/workflows/`) — окремий крок після цього spec.

---

## Критичне обмеження: заборона паралельного запуску

**eslint/oxlint/lint НЕ можна запускати паралельно** — ні між собою в межах одного прогону, ні одночасно в кількох процесах/агентах/shell-сесіях.

**Причина:** конкурентний eslint перевантажує диск і CPU, призводить до некоректних результатів і нестабільного виконання. Це зафіксовано в `CLAUDE.md` проєкту.

**Вимоги:**
- Обидва виконавці (`n-cursor lint` і `n-cursor lint-ci`) запускають кроки **строго послідовно** (`sequential: true` в реалізації; жодних `Promise.all`, паралельних процесів чи workers для lint-кроків).
- Порядок кроків фіксований і передбачуваний (не concurrent).
- При написанні implementation plan: команди `/n-lint` і `/lint-ci` **не розбиваються на паралельні субагенти** — це єдина послідовна задача.

---

## Атрибут `lint` у `meta.json`

Поле `lint` додається до `meta.json` правила (поряд з наявним `auto`):

```json
{ "auto": "завжди", "lint": "quick" }
```

| Значення | Де виконується | Коли використовувати |
|---|---|---|
| `"quick"` | і в `lint`, і в `lint-ci` | швидкий крок, доречний завжди |
| `"ci"` | лише в `lint-ci` | важкий/крос-файловий аналіз |
| відсутнє | ніде | правило не є lint-кроком |

Семантика: **quick ⊆ ci**. Повний прогін (`lint-ci`) виконує all quick + all ci кроків.

### JSON-схема

У `rule-meta.json` (або окремій `lint-phase.json`) поле `lint` — enum `"quick" | "ci"`, optional.

---

## Розщеплення `js-lint` (D3)

`js-lint` — єдиний composite-крок, що містить інструменти обох фаз:

| Інструмент | Фаза | Поточний рядок |
|---|---|---|
| oxlint | quick | `bunx oxlint --fix` |
| eslint | quick | `bunx eslint --fix .` |
| jscpd | ci | `bunx jscpd .` |
| knip | ci | `bunx knip --no-exit-code` |

**Рішення:** правило `js-lint` описує quick-крок. CI-інструменти виносяться в окреме правило (або окремий lint-step-концерн) `js-lint-ci` з `"lint": "ci"`. Обидва живуть у директорії `npm/rules/js-lint/` — quick-крок у поточному правилі, ci-крок у новому під-записі або окремому `meta.json` запису.

> Конкретний механізм реєстрації ci-кроку (окремий `meta.json` у `npm/rules/js-lint-ci/` або поле-масив у `js-lint/meta.json`) — уточнити на початку реалізації Task 2. Обидва варіанти сумісні з цим spec.

---

## Класифікація lint-кроків (аналіз виконано перед плануванням)

| Крок / правило | Інструмент(и) | Фаза | Обґрунтування |
|---|---|---|---|
| `lint-rego` | `opa check`, `regal`, `conftest verify` | **quick** | Per-path, фіксований `npm/rules/`, швидкий однопрохідний аналіз |
| `lint-style` | `stylelint` | **quick** | Per-file, stateless між файлами |
| `oxlint` (з js-lint) | `bunx oxlint --fix` | **quick** | Rust-based per-file, дуже швидкий |
| `eslint` (з js-lint) | `bunx eslint --fix .` | **quick** | Per-file, немає крос-файлових правил у конфізі |
| `lint-text` цілком | `cspell`, `shellcheck`, `dotenv-linter`, `markdownlint-cli2`, `v8r` | **quick** | Усі підкроки per-file/stateless; v8r може бути повільний через fetch схем, але per-file |
| `oxfmt` | `oxfmt .` | **quick** | Fast formatter, per-file |
| `lint-ga` | `actionlint`, `zizmor --collect=workflows`, `conftest check-ga` | **ci** | Крос-файловий: сканує весь `.github/workflows/`, аналіз залежностей між workflow |
| `lint-security` | `trufflehog filesystem .` | **ci** | Сканує все дерево; потребує контексту по всьому репо для ентропійного аналізу |
| `jscpd` (з js-lint) | `bunx jscpd .` | **ci** | Детектор дублікатів — потребує індексу всіх файлів одночасно |
| `knip` (з js-lint) | `bunx knip --no-config-hints` | **ci** | Граф залежностей по всіх пакетах; per-file аналіз неможливий |

**Підсумок:** `lint-js` — єдиний композитний крок що змішує фази. `lint-text` та `lint-rego` — повністю quick. `lint-ga` і `lint-security` — повністю ci.

### Флаги у quick-фазі

| Інструмент | quick-флаги (додаткові) |
|---|---|
| `eslint` | `--quiet` (тільки errors, без warnings) |
| решта quick | без додаткових флагів |

---

## Конвенція скриптів: F1

| Скрипт | Фаза | Замінює |
|---|---|---|
| `lint` | quick (новий) | поточний `lint-js` (швидка частина) |
| `lint-ci` | full (новий) | поточний `lint` (усі перевірки) |
| `lint-js` | — | **видалити** як публічний скрипт |

`lint-js` стає внутрішнім кроком CLI і більше не присутній у `package.json` проєктів. Усі посилання на `bun run lint-js` замінюються на `bun run lint` (quick) або `bun run lint-ci` (full) залежно від контексту.

> **Backward-compat:** `lint-js` є лише в dev-проєкті пакета (`npm/package.json`). Зовнішні споживачі не кличуть `lint-js` напряму — вони використовують `lint` з кореневого `package.json`. Тому ламаючих змін для зовнішніх репо немає.

---

## CLI-виконавець

Нова команда `n-cursor lint` і `n-cursor lint-ci` у пакеті `@nitra/cursor`:

1. Читає `meta.json` усіх правил у `npm/rules/*/meta.json` (ті, що мають поле `lint`).
2. Для `lint`: відбирає кроки з `lint === "quick"`, виконує їх із quick-флагами.
3. Для `lint-ci`: відбирає всі кроки (`quick` + `ci`), виконує з повними флагами.
4. **Кроки виконуються строго послідовно** (sequential) — жодної паралелізації.
5. Порядок виконання: визначається полем `lintOrder` у `meta.json` або лексикографічним ім'ям правила (деталь реалізації).

### Скрипти в `package.json` проєктів

```json
{
  "lint":    "n-cursor lint",
  "lint-ci": "n-cursor lint-ci"
}
```

Або через `bunx`/`npx` залежно від поточного канону проєкту.

---

## Правило `n-js-lint` — оновлення

- Описує **обидва** скрипти (`lint`, `lint-ci`) як обовʼязкові в `package.json`; `lint-js` — видалити з канону.
- Check-концерн `js_lint.mjs` валідує наявність `lint` і `lint-ci`, **забороняє** `lint-js` у `scripts`.
- Документація правила пояснює: семантику quick⊆ci, заборону паралельного запуску, sequential-природу обох команд.

---

## Схема rule-meta.json — розширення

Поточна схема `rule-meta.json` вже має `auto`. Додаємо:

```json
{
  "properties": {
    "lint": {
      "type": "string",
      "enum": ["quick", "ci"],
      "description": "Фаза lint-прогону: quick (швидкий, у lint і lint-ci) або ci (важкий, лише у lint-ci)"
    }
  }
}
```

---

## Тестування

- **Юніт-тести** `lint-phase-parser.test.mjs`: `quick`/`ci`/absent парсяться коректно; quick⊆ci виконується у зібраному наборі.
- **Інтеграційний тест**: `n-cursor lint --dry-run` і `n-cursor lint-ci --dry-run` виводять очікувані списки кроків.
- **Регресія**: `bun run lint-ci` == поточний `bun run lint` за набором перевірок (нічого не втрачено).

---

## Поетапна реалізація (орієнтир для writing-plans)

1. **Схема** — додати `lint` enum до `rule-meta.json` + оновити v8r.
2. **meta.json правил** — проставити `lint: "quick" | "ci"` для кожного правила; розщепити js-lint-ci.
3. **CLI** — `n-cursor lint` і `n-cursor lint-ci` (читає meta.json, збирає набір, виконує).
4. **Скрипти проєкту** — замінити `lint` у `package.json`, додати `lint-ci`.
5. **Правило `n-js-lint`** — оновити опис і check-концерн.
6. **Тести** + регресія.
7. **Docs** + change-файл.
