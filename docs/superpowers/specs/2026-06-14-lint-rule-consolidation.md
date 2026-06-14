# Правило `lint`: стандартизація scope (per-file vs full) і контекстів запуску

**Дата:** 2026-06-14
**Статус:** чернетка — на затвердження
**Зв'язані документи:** спека `2026-06-12-doc-files-lint-doc-fix-doc-split.md` (`doc-files` — один із класифікованих тут механізмів), канон `lint-*`/`fix-<id>` і серіалізація важких CLI у `.cursor/rules/scripts.mdc`, утиліти `npm/scripts/lib/changed-files.mjs` (`resolveChangedBase`, `collectChangedFilesSince` — уже використовує `coverage --changed`)

## 1. Мета

Звести всі lint-механізми пакета під **єдиний контракт класифікації**, який детерміновано
відповідає на два питання для кожного механізму:

1. **Чи детектор декомпозується** на змінені файли (per-file) чи нероздільно крос-файловий (full).
2. **Як він запускається в кожному з трьох контекстів** (локальний агент / CI / повний аудит).

Класифікація живе в `meta.json` правила-механізму — одне декларативне джерело істини, яке
читають і оркестратор `n-cursor lint`, і GA-workflow, і локальні hook'и. Жодного хардкоду
«цей запускати по змінених, той — повністю» в коді оркестратора чи в YAML.

Наскрізна вимога: **усі per-file перевірки рахують дельту відносно origin** (а не робочого
дерева vs HEAD), щоб «changed» означало «нове відносно вже перевіреного пушу» — лінт гарантує,
що в новий стан не потрапив неперевірений код.

## 2. Поточний стан (звідки мігруємо)

У репо **дві паралельні** lint-системи:

| Система | Де | Як рахує scope |
| --- | --- | --- |
| Індивідуальні скрипти | `package.json`: `lint-js`, `lint-ga`, `lint-text`, `lint-rego`, `lint-security`, `lint-style`, `lint-python`; кореневий `lint` їх ланцюжить; кожен має свій `.github/workflows/lint-*.yml` | завжди весь репо (`.`) |
| Оркестратор | `npm/scripts/lint-cli.mjs` → `n-cursor lint` (quick) / `lint-ci` (all); data-driven по `meta.json:lint` | quick = `collectChangedFiles` (**vs HEAD**); ci = весь репо |

`meta.json:lint` сьогодні — рядок `"quick" | "ci"` (`npm/scripts/lib/rule-meta.mjs:parseRuleLintPhase`,
валідація `npm/rules/npm-module/js/rule_meta.mjs:checkLintField`). Семантика змішана: `quick`
кодує і «дробиться на файли», і «запускається в quick-фазі»; `ci` — і «крос-файл», і «лише в lint-ci».

Поточні значення:

| rule | `lint` | детектор |
| --- | --- | --- |
| `js-lint` | `quick` | oxlint/eslint (per-file) |
| `style-lint` | `quick` | stylelint (per-file) |
| `js-lint-ci` | `ci` | jscpd + knip (крос-файл) |
| `security` | `ci` | trufflehog (весь tree) |
| `ga` | `ci` | actionlint/zizmor + rego (крос-файл + малий корпус) |
| `rego` | `ci` | opa check --strict (крос-модульний) + regal + conftest |
| `text` | `ci` | cspell/markdownlint/shellcheck/dotenv/v8r (**усі per-document**) |
| `doc-files` | — (нове) | docgen-scan staleness (per-file) |

Проблема: `text` помічений `ci`, хоч усі його кроки per-document; база quick-фази — HEAD,
а не origin; дві системи не узгоджені; класифікація не виражає «security per-file локально,
але full у CI».

## 3. Ухвалені рішення

| # | Питання | Рішення |
| --- | --- | --- |
| А | Дві осі замість однієї | `meta.json:lint` стає об'єктом `{scope, ci}`: `scope` — здатність декомпозиції (`per-file`\|`full`), `ci` — опційний override режиму в CI (дефолт = `scope`) |
| Б | Шорткат | рядок `"per-file"` ≡ `{scope:"per-file"}`, `"full"` ≡ `{scope:"full"}`; об'єктна форма потрібна лише там, де `ci ≠ scope` (наразі тільки `security`) |
| В | База дельти | усі per-file прогони рахують `collectChangedFilesSince(resolveChangedBase())` — merge-base vs `main`/`origin/main`, fail-closed на недосяжний base. **Замінює** `collectChangedFiles` (vs HEAD) в оркестраторі |
| Г | Три контексти | деривуються з `{scope, ci}` без додаткових полів (див. §5) |
| Д | `security` | `{scope:"per-file", ci:"full"}` — локально агенту швидкий per-file скан, у CI завжди повний (defense-in-depth: ротація baseline, зміна `.trufflehog-exclude`) |
| Е | Домівка | нове правило **`npm/rules/lint/`** — оркестратор + контракт класифікації + канон-`.mdc`. Детектори лишаються у своїх правилах; кожен декларує `lint` у власному `meta.json` (не зливаємо каталоги — кожен механізм має власні policy/конфіги/тести; канон `scripts.mdc` «одне правило — один каталог») |
| Ж | Сумісність `meta.json` | hard-rename `quick`/`ci` → новий формат у тому ж кроці: `meta.json` **не** синкається у споживачів (`scripts.mdc`), зовнішньої сумісності тримати не треба |
| З | `lint.mjs`-контракт | сигнатура `lint(files, cwd)` без змін: `files` — масив змінених (per-file) або `undefined` (full) |

## 4. `meta.json:lint` — схема

```jsonc
// npm/rules/<id>/meta.json
{
  "lint": {
    "scope": "per-file" | "full",   // чи детектор декомпозується на changed-set
    "ci": "per-file" | "full"        // опційний; режим у CI; дефолт = scope
  }
}
```

Еквівалентні шорткати:

```jsonc
"lint": "per-file"   // ≡ { "scope": "per-file", "ci": "per-file" }
"lint": "full"       // ≡ { "scope": "full",     "ci": "full" }
"lint": undefined    // правило не є lint-кроком
```

Цільові значення всіх механізмів:

| rule | `lint` |
| --- | --- |
| `js-lint` | `"per-file"` |
| `style-lint` | `"per-file"` |
| `doc-files` | `"per-file"` |
| `text` | `"per-file"` *(переїзд із `ci`)* |
| `security` | `{ "scope": "per-file", "ci": "full" }` |
| `js-lint-ci` | `"full"` |
| `rego` | `"full"` |
| `ga` | `"full"` |

**Інваріанта валідатора:** наявність `lint` (будь-якої форми) ⇒ існує `js/lint.mjs` (або
`lint/lint.mjs`) у каталозі правила; `ci` без `scope` чи невідомі значення — `fail`.

## 5. Три контексти виконання

Усі три деривуються з `{scope, ci}` чисто, без нових полів. Хелпер
`effectiveCi(rule) = rule.ci ?? rule.scope`.

| Контекст | Entry-point | Які правила | Режим |
| --- | --- | --- | --- |
| **A · Локальний агент** (змінив файли) | `n-cursor lint` (дефолт) | лише `scope === "per-file"` | `lint(changedVsOrigin, cwd)` |
| **B · CI** | `n-cursor lint --ci` (виклик у GA) | **усі** | `effectiveCi === "per-file"` → `lint(changedVsOrigin)`; `"full"` → `lint(undefined)` |
| **C · Повний аудит** | `n-cursor lint --full` | **усі** | `lint(undefined)` — весь репо |

Наслідки:

- Контекст A **не** запускає whole-tree (`scope:"full"`) механізми — це робота CI; агент після
  правок отримує лише швидкий per-file фідбек.
- У контексті B `security` (`ci:"full"`) і всі `scope:"full"` йдуть повними; `js-lint`,
  `style-lint`, `doc-files`, `text` — по дельті vs origin (під інваріантом «base зелений» нова
  проблема завжди в зміненому файлі).
- Контекст C — для thorough-перевірки локально / перед релізом; ігнорує per-file-оптимізацію.

## 6. База дельти: HEAD → origin

`npm/scripts/lib/changed-files.mjs` уже містить потрібне (використовує `coverage --changed`):

- `resolveChangedBase(cwd)` — `main` → `origin/main` (merge-base) → `null`.
- `collectChangedFilesSince(base, cwd)` — `git diff <base>` з робочим деревом справа (ловить
  закомічене, staged і uncommitted); **fail-closed** на недосяжний base (rebase/force-update).

Зміни:

- `lint-cli.mjs:runLint` quick-шлях: `collectChangedFiles(cwd)` → `collectChangedFilesSince(resolveChangedBase(cwd), cwd)`.
- Якщо `resolveChangedBase` повертає `null` (немає `main`/`origin/main`) — fallback на
  working-tree vs HEAD (поточна поведінка `collectChangedFilesSince(null)`), щоб лінт працював
  у свіжому/відірваному репо.
- both-direction мапінг (змінене джерело → його артефакт; змінений артефакт → джерело) — на
  розсуд конкретного `lint.mjs` (для `doc-files` він обов'язковий, див. спеку doc-files §6).

## 7. Структура `npm/rules/lint/`

```text
npm/rules/lint/
  lint.mdc                    # канон: класифікація meta.json, три контексти, база-origin
  meta.json                   # саме правило lint — { "auto": "завжди" } (без lint-поля: воно не self-lint)
  js/
    orchestrate.mjs           # ← переїзд lint-cli.mjs: selectLintRules + runLint({mode})
    tests/orchestrate.test.mjs
  policy/
    package_json/
      package_json.rego       # кореневий package.json має "lint"/"lint-ci"/"lint-full" скрипти
      package_json_test.rego
      target.json
      template/package.json.contains.json
```

Детектори лишаються у своїх правилах (`js-lint/js/lint.mjs`, `text/lint/lint.mjs`,
`security/js/lint.mjs`, `js-lint-ci/js/lint.mjs`, `rego/lint/lint.mjs`, `ga/lint/lint.mjs`,
`style-lint/js/lint.mjs`, `doc-files/js/lint.mjs`); змінюється тільки їхній `meta.json:lint`.

Валідатор `meta.json` (`npm-module/js/rule_meta.mjs:checkLintField`) і парсер
(`scripts/lib/rule-meta.mjs:parseRuleLintPhase` → `parseRuleLintSpec`) вчаться об'єктній формі.

## 8. CLI і package.json

| Команда | Контекст | Реалізація |
| --- | --- | --- |
| `n-cursor lint` | A (агент, per-file vs origin) | `runLint({ mode: 'agent' })` |
| `n-cursor lint --ci` | B (CI) | `runLint({ mode: 'ci' })` |
| `n-cursor lint --full` | C (повний аудит) | `runLint({ mode: 'full' })` |

Кореневий `package.json` цього репо:

```jsonc
{
  "scripts": {
    "lint": "n-cursor lint",          // дефолт = контекст A
    "lint-ci": "n-cursor lint --ci",
    "lint-full": "n-cursor lint --full"
  }
}
```

Індивідуальні `lint-<x>` скрипти та їхні окремі прямі виклики в кореневому ланцюжку
**прибираються** — єдина точка входу через оркестратор за `meta.json`. (Самі `lint-<x>`
підкоманди `n-cursor` лишаються — їх кличе оркестратор і вони доступні для точкового дебагу.)
Серіалізація кожного важкого кроку — через `runStandardLint` як і зараз (`scripts.mdc`).

## 9. GA workflows

Кожен механізм у CI запускається у своєму режимі за `meta.json`. Два варіанти розкладки
(вирішити на імплементації):

- **9a (рекомендовано):** один workflow `lint.yml`, крок `n-cursor lint --ci` — оркестратор
  сам прожене кожне правило в його CI-режимі. Менше дублювання, класифікація — єдине джерело.
- **9b:** зберегти per-механізм workflow (`lint-js.yml`, `lint-text.yml`, …), кожен кличе
  свою підкоманду; whole-tree — як є, per-file — з `--since` від last-green (див. спеку
  doc-files §8 щодо резолву last-green через `gh run list … --status success`).

`security` у CI — **завжди** повний прогін незалежно від варіанта (`ci:"full"`).

## 10. Порядок міграції

1. **Схема + валідатор.** `parseRuleLintSpec` (об'єкт/шорткат) у `rule-meta.mjs`;
   `checkLintField` під новий формат; JSON-схема `schemas/` якщо є.
2. **База-origin.** `lint-cli.mjs` quick-шлях → `collectChangedFilesSince(resolveChangedBase())`.
3. **Правило `lint`.** Створити `npm/rules/lint/` (mdc, meta, `js/orchestrate.mjs` ← `lint-cli.mjs`,
   policy package_json); три режими `agent|ci|full`.
4. **Класифікація.** Оновити `meta.json:lint` усіх восьми механізмів за таблицею §4
   (зокрема `text` → per-file, `security` → об'єкт).
5. **package.json + GA.** Скрипти `lint`/`lint-ci`/`lint-full`; workflow за §9; прибрати
   старі прямі `lint-<x>` з кореневого ланцюжка.
6. **Тести.** `selectLintRules`/`effectiveCi` per контекст; парсер нового формату; база-origin
   (`resolveChangedBase` mock); `text`/`security` у правильних наборах.
7. **Фінал.** `bun test` у `npm/`, один послідовний `n-cursor lint --full`; change-файли
   (`npm/` змінено → bump за n-changelog, minor).

## 11. Тести

- `parseRuleLintSpec`: шорткати, об'єкт, дефолт `ci=scope`, невалідні значення → null/fail.
- `selectLintRules(metaById, mode)`: A → лише per-file; B → всі; C → всі; сортування алфавітне.
- `effectiveCi`: `security` → `full`; `text` → `per-file`; `js-lint-ci` → `full`.
- `runLint`: режим A передає changed-список, B/full — undefined для full-правил, changed для
  ci:"per-file"; fail-fast на першому ненульовому коді.
- База: `resolveChangedBase` null → fallback HEAD; недосяжний base → throw (fail-closed).
- Валідатор: `lint` без `js/lint.mjs` → fail; об'єкт без `scope` → fail.

## 12. Сумісність і semver

- **Minor-реліз**: новий формат `meta.json:lint` — внутрішній (не синкається у споживачів);
  нові команди `lint --ci`/`--full`; кореневі скрипти споживача оновлюються через policy.
- `n-cursor lint` (без прапорця) змінює базу з HEAD на origin і набір на per-file-only —
  зафіксувати в CHANGELOG (поведінкова зміна quick-фази).
- `lint-ci` стара підкоманда → аліас `lint --ci` (deprecation-warn), зняття — наступний major.
