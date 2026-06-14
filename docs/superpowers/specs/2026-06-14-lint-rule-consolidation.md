# Правило `lint`: стандартизація scope (per-file vs full) і контекстів запуску

**Дата:** 2026-06-14
**Статус:** чернетка — на затвердження
**Зв'язані документи:** спека `2026-06-12-doc-files-lint-doc-fix-doc-split.md` (`doc-files` — один із класифікованих тут механізмів), канон `lint-*`/`fix-<id>` і серіалізація важких CLI у `.cursor/rules/scripts.mdc`, утиліти `npm/scripts/lib/changed-files.mjs` (`resolveChangedBase`, `collectChangedFilesSince` — уже використовує `coverage --changed`), **компаньйон-спека `docs/specs/2026-06-14-lint-orchestrator-fix-readonly-unification-design.md`** (вісь поведінки `fix`/`--read-only`, поглинання `fix`-двигуна, omlx-ескалація)

> **Amendment (2026-06-14, узгоджено з компаньйон-спекою).** Вісь scope (ця спека) доповнюється **ортогональною віссю поведінки** `fix`(default)/`--read-only` (компаньйон-спека). Наслідки для рішень нижче:
>
> - **Контекст B `--ci` схлопується** у `--read-only --full`: CI ганяє весь репо в read-only (нуль мутацій, нуль LLM). Окремий прапор `--ci` і хелпер `effectiveCi` **прибираються**.
> - Оскільки CI тепер завжди `--full`, **поле-override `meta.json:lint.ci` стає зайвим**; `lint` лишається рядком `"per-file" | "full"` (об'єктна форма більше не потрібна). `security` → `"per-file"` (у CI він і так full, бо CI=`--full`).
> - **Контракт `lint.mjs` розширюється** до `lint(files, cwd, { readOnly })` (було `lint(files, cwd)`).
>
> Правки нижче вже враховують amendment (рядки А/Б/Д/З §3, §4, §5, §8, §9, §12).

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
| А | Вісь scope | `meta.json:lint` — рядок `"per-file" \| "full"`: здатність декомпозиції детектора на changed-set. *(Amendment: об'єктна форма `{scope, ci}` скасована — CI завжди `--full`, тож override не потрібен.)* |
| Б | Шорткат | значення — лише рядок `"per-file"` або `"full"`; `undefined` = правило не lint-крок. *(Amendment: об'єктна форма прибрана.)* |
| В | База дельти | усі per-file прогони рахують `collectChangedFilesSince(resolveChangedBase())` — merge-base vs `main`/`origin/main`, fail-closed на недосяжний base. **Замінює** `collectChangedFiles` (vs HEAD) в оркестраторі |
| Г | Дві осі × контексти | scope (`per-file`/`full`) × behavior (`fix`/`--read-only`) → контексти деривуються без додаткових полів (див. §5) |
| Д | `security` | `"per-file"` — локально агенту швидкий per-file скан; у CI повний автоматично, бо CI=`--read-only --full`. *(Amendment: було `{scope:"per-file", ci:"full"}`.)* |
| Е | Домівка | нове правило **`npm/rules/lint/`** — оркестратор + контракт класифікації + канон-`.mdc`. Детектори лишаються у своїх правилах; кожен декларує `lint` у власному `meta.json` (не зливаємо каталоги — кожен механізм має власні policy/конфіги/тести; канон `scripts.mdc` «одне правило — один каталог») |
| Ж | Сумісність `meta.json` | hard-rename `quick`/`ci` → новий формат у тому ж кроці: `meta.json` **не** синкається у споживачів (`scripts.mdc`), зовнішньої сумісності тримати не треба |
| З | `lint.mjs`-контракт | сигнатура `lint(files, cwd, { readOnly })`: `files` — масив змінених (per-file) або `undefined` (full); `readOnly` — лише детект без мутацій (дефолт `false`). *(Amendment: додано `opts.readOnly`.)* |

## 4. `meta.json:lint` — схема

```jsonc
// npm/rules/<id>/meta.json
{
  "lint": "per-file" | "full"   // чи детектор декомпозується на changed-set
}
```

Значення:

```jsonc
"lint": "per-file"   // детектор дробиться на змінені файли (дельта vs origin)
"lint": "full"       // нероздільно крос-файловий — лише у --full / CI
"lint": undefined    // правило не є lint-кроком
```

> *(Amendment.)* Об'єктна форма `{scope, ci}` скасована: CI=`--read-only --full` ганяє все повністю, тож per-rule CI-override не потрібен.

Цільові значення всіх механізмів:

| rule | `lint` |
| --- | --- |
| `js-lint` | `"per-file"` |
| `style-lint` | `"per-file"` |
| `doc-files` | `"per-file"` |
| `text` | `"per-file"` *(переїзд із `ci`)* |
| `security` | `"per-file"` *(у CI повний автоматично — CI=`--full`)* |
| `js-lint-ci` | `"full"` |
| `rego` | `"full"` |
| `ga` | `"full"` |

**Інваріанта валідатора:** наявність `lint` ⇒ існує `js/lint.mjs` (або
`lint/lint.mjs`) у каталозі правила; значення поза `"per-file" | "full"` — `fail`.

## 5. Контексти виконання (дві осі)

Контексти деривуються з двох ортогональних осей — **scope** (`per-file`/`full`, ця спека) ×
**behavior** (`fix`/`--read-only`, компаньйон-спека) — без нових полів.

| Контекст | Entry-point | Які правила | Режим |
| --- | --- | --- | --- |
| **A · Локальний агент** (змінив файли) | `n-cursor lint` | лише `lint === "per-file"` | `lint(changedVsOrigin, cwd, { readOnly:false })` — fix |
| **A′ · Локальний детект / pre-commit** | `n-cursor lint --read-only` | лише `lint === "per-file"` | `lint(changedVsOrigin, cwd, { readOnly:true })` |
| **B · CI** | `n-cursor lint --read-only --full` (виклик у GA) | **усі** | `lint(undefined, cwd, { readOnly:true })` — весь репо, нуль мутацій |
| **C · Повний локальний аудит** | `n-cursor lint --full` | **усі** | `lint(undefined, cwd, { readOnly:false })` — весь репо, fix |

> *(Amendment.)* Колишній контекст B `--ci` з `effectiveCi`-міксом (per-file правила по дельті в
> CI) **схлопнуто** у `--read-only --full`. Хелпер `effectiveCi` прибрано.

Наслідки:

- Контекст A/A′ **не** запускає whole-tree (`lint:"full"`) механізми — це робота CI; агент після
  правок отримує лише швидкий per-file фідбек.
- Контекст B — увесь репо в read-only: усі механізми (включно з `js-lint-ci`, `rego`, `ga`,
  `security`) йдуть повністю, без мутацій і без LLM; падіння при будь-якій знахідці. Трейдоф:
  втрата per-file-оптимізації CI заради простоти двовісної моделі (read-only детект дешевий).
- Контекст C — thorough-перевірка з автофіксом локально / перед релізом.

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
  lint.mdc                    # канон: класифікація meta.json, контексти (scope×behavior), база-origin
  meta.json                   # саме правило lint — { "auto": "завжди" } (без lint-поля: воно не self-lint)
  js/
    orchestrate.mjs           # ← переїзд lint-cli.mjs: selectLintRules + runLint({full, readOnly})
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
| `n-cursor lint` | A (агент, per-file vs origin, fix) | `runLint({ full:false, readOnly:false })` |
| `n-cursor lint --read-only` | A′ (детект / pre-commit) | `runLint({ full:false, readOnly:true })` |
| `n-cursor lint --read-only --full` | B (CI) | `runLint({ full:true, readOnly:true })` |
| `n-cursor lint --full` | C (повний аудит, fix) | `runLint({ full:true, readOnly:false })` |

Дві ортогональні опції: `--full` (scope) × `--read-only` (behavior). Окремого прапора `--ci`
немає — CI = `--read-only --full`.

Кореневий `package.json` цього репо:

```jsonc
{
  "scripts": {
    "lint": "n-cursor lint",                       // дефолт = контекст A
    "lint-ci": "n-cursor lint --read-only --full", // контекст B
    "lint-full": "n-cursor lint --full"            // контекст C
  }
}
```

Індивідуальні `lint-<x>` скрипти та їхні окремі прямі виклики в кореневому ланцюжку
**прибираються** — єдина точка входу через оркестратор за `meta.json`. (Самі `lint-<x>`
підкоманди `n-cursor` лишаються — їх кличе оркестратор і вони доступні для точкового дебагу.)

**Паралелізм (узгоджено з компаньйон-спекою):** заборона паралельного `eslint`/`oxlint`
**знімається** — паралельні прогони по диз'юнктних file-shard-ах не конфліктують. Безумовна
`runStandardLint`-серіалізація лишається лише для whole-tree-прогонів того самого корпусу
(`--full`-механізми). Потребує оновлення `CLAUDE.md` і `.cursor/rules/scripts.mdc`.

## 9. GA workflows

Кожен механізм у CI запускається у своєму режимі за `meta.json`. Два варіанти розкладки
(вирішити на імплементації):

- **9a (рекомендовано):** один workflow `lint.yml`, крок `n-cursor lint --read-only --full` —
  оркестратор прожене всі правила в read-only по всьому репо. Менше дублювання, класифікація —
  єдине джерело. Нуль мутацій, нуль LLM.
- **9b:** зберегти per-механізм workflow (`lint-js.yml`, `lint-text.yml`, …), кожен кличе
  `n-cursor lint --read-only --full <rule>` для свого правила.

`security` у CI — повний прогін автоматично, бо CI=`--full`.

## 10. Порядок міграції

1. **Схема + валідатор.** `parseRuleLintSpec` (рядок `"per-file"|"full"`) у `rule-meta.mjs`;
   `checkLintField` під новий формат; JSON-схема `schemas/` якщо є.
2. **База-origin.** `lint-cli.mjs` quick-шлях → `collectChangedFilesSince(resolveChangedBase())`.
3. **Правило `lint`.** Створити `npm/rules/lint/` (mdc, meta, `js/orchestrate.mjs` ← `lint-cli.mjs`,
   policy package_json); опції `--full` × `--read-only`.
4. **Класифікація.** Оновити `meta.json:lint` усіх восьми механізмів за таблицею §4
   (зокрема `text` → per-file, `security` → `"per-file"`).
5. **package.json + GA.** Скрипти `lint`/`lint-ci`(=`--read-only --full`)/`lint-full`; workflow
   за §9; прибрати старі прямі `lint-<x>` з кореневого ланцюжка.
6. **Тести.** `selectLintRules` per контекст; парсер нового формату; база-origin
   (`resolveChangedBase` mock); `text`/`security` у правильних наборах.
7. **Фінал.** `bun test` у `npm/`, один послідовний `n-cursor lint --full`; change-файли
   (`npm/` змінено → bump за n-changelog; разом із віссю поведінки — **major**, див. §12).

> Вісь поведінки (`--read-only`, поглинання `fix`-двигуна, omlx) — окремий план міграції у
> компаньйон-спеці; ця нумерація покриває лише вісь scope.

## 11. Тести

- `parseRuleLintSpec`: рядки `"per-file"`/`"full"`, `undefined`, невалідні значення → null/fail.
- `selectLintRules(metaById, ctx)`: A/A′ → лише per-file; B/C → всі; сортування алфавітне.
- `runLint`: контекст A/A′ передає changed-список (per-file), B/C → undefined (весь репо);
  `readOnly` пробрасується у `lint.mjs`; fail-fast на першому ненульовому коді.
- Інваріант нуль-мутацій: `lint --read-only` на брудному дереві → `git diff` незмінний.
- База: `resolveChangedBase` null → fallback HEAD; недосяжний base → throw (fail-closed).
- Валідатор: `lint` без `js/lint.mjs` → fail; значення поза `"per-file"|"full"` → fail.

## 12. Сумісність і semver

- **Major-реліз** (узгоджено з компаньйон-спекою): новий формат `meta.json:lint`; нові опції
  `--read-only`/`--full`; видалення `n-cursor fix`/`fix-t0`/`_fix-check` **без аліасів** (R-5 —
  зворотної сумісності не тримаємо).
- `n-cursor lint` (без прапорця) змінює базу з HEAD на origin, набір на per-file-only і поведінку
  на fix-by-default — зафіксувати в CHANGELOG.
- Стара підкоманда `lint-ci` → `lint --read-only --full` (без deprecation-аліасу).
