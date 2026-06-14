# Spec: lint — вісь поведінки `fix`(default)/`--read-only`, поглинання `fix`-двигуна, omlx-ескалація

**Дата:** 2026-06-14
**Статус:** Draft
**Тип:** Major (breaking) — змінює публічний CLI-контракт і per-rule контракт; **без зворотної сумісності**

**Зв'язані документи:**

- `docs/superpowers/specs/2026-06-14-lint-rule-consolidation.md` — **джерело істини по осі scope** (`per-file`/`full`, контексти запуску, база-origin, дім `npm/rules/lint/`). Ця спека — **ортогональний компаньйон по осі поведінки**.
- `docs/superpowers/specs/2026-06-12-doc-files-lint-doc-fix-doc-split.md` — `doc-files` як один із класифікованих механізмів; конвенція exit-кодів.
- `.cursor/rules/scripts.mdc` — контракт оркестратора (convergence-loop, check-gate, escalation ladder).
- `npm/lib/llm.mjs` + `npm/lib/omlx.mjs` + `npm/lib/models.mjs` — єдина точка LLM-викликів; маршрутизація `omlx/<model>` → прямий HTTP, каскад local→cloud через `resolveModel(tier)`.

---

## Проблема

Сьогодні дві окремі машини на одну по суті задачу «привести проєкт у відповідність»:

1. **`lint`-світ** — прогін зовнішніх тулів (oxlint/eslint/jscpd/knip/cspell/stylelint/actionlint/zizmor/trufflehog…). Оркестратор `npm/scripts/lint-cli.mjs`, контракт `js/lint.mjs → lint(files, cwd)`. Прямий прогін без циклу. Тули з `--fix` **завжди** з `--fix` — навіть у CI, де мутувати дерево не можна.
2. **`fix`-світ** — конформність конфігів/файлів/воркфлоу через **convergence-loop + check-gate + Tier0→LLM-ескалація**. Оркестратор `npm/skills/fix/js/orchestrator.mjs`, контракт `fix.mjs` + `check()`-concerns + Rego-policy.

Наслідки:

- **Немає осі fix vs read-only** — у CI лінт або мутує дерево, або немає чистого «лише детект».
- **Detect-only тули нічого не фіксять** (knip/jscpd/cspell/actionlint/zizmor) — хоча двигун LLM-ескалації **вже існує** в `fix`-світі, просто не під'єднаний.
- **Два оркестратори, два контракти, два скіли** (`/n-lint`, `/n-fix`).

**Ключове спостереження.** Двигун `fix` (Tier0-детермінований → check-gate → LLM-ескалація) — це рівно та машина, якої потребує автофікс detect-only тулів. Лінтер-тули мають стати **ще одними concern-ами**, що годують той самий check-gate. Тому `n-cursor fix` не отримує аліас — його **двигун поглинається** fix-режимом `lint`, а самі команди видаляються.

---

## Цілі

1. **Вісь поведінки:** `lint` за замовчуванням **і детектить, і виправляє** (fix-режим); прапор `--read-only` лишає **лише детект** без мутацій.
2. **Один оркестратор, один per-rule контракт.** Зовнішні тули, `check()`-concerns і Rego-policy — це **concern-и** під цим контрактом.
3. **Detect-only тули отримують автофікс** — детермінованим скриптом (Tier 0), або LLM (Tier 1+) через наявний двигун convergence-loop. **Усе фіксимо** — винятків `manual` немає.
4. **CI ⇒ `--read-only --full`.** Нуль мутацій, нуль LLM, падіння при будь-якій знахідці.
5. **`n-cursor fix` видаляється повністю** (без аліасу): двигун, check-gate, Tier0-auto і LLM-ескалація переходять у fix-режим `lint`.
6. **Усі правила беруть участь у lint** (за класифікацією spec consolidation).
7. **Output дає лише «що не так»** — і в read-only, і в fix (у fix — лише невиправний залишок).
8. **LLM-ескалація — на omlx** (локальний MLX), не хмарна: прямі виклики через `lib/llm.mjs` (`omlx/<model>`) або агентний `mimo code`. Cloud — лише фолбек каскаду.

---

## Не в цьому spec

- **Вісь scope** (`per-file`/`full`, контексти, база-origin, `meta.json:lint={scope,ci}`, дім `npm/rules/lint/`) — повністю в spec consolidation; тут лише посилаємось.
- **Конкретні per-tool LLM-фіксери** для кожного detect-only тула (knip/jscpd/cspell/actionlint/zizmor/v8r/regal…) — **окрема задача-наступник після реалізації цієї спеки**. Тут лише стратегія класифікації (`auto`/`llm`) і двигун, що їх викликає.
- **Зворотна сумісність** — не тримаємо. Hard-rename, старі команди видаляються (R-5).

---

## Зв'язок зі spec consolidation: дві ортогональні осі

| Вісь | Значення | Джерело істини |
| --- | --- | --- |
| **Scope** (обсяг) | default (дельта vs origin) \| `--full` (весь репо) | **spec consolidation** |
| **Behavior** (поведінка) | `fix` (default) \| `--read-only` | **ця спека** |

Осі незалежні → чотири комбінації двох прапорів `--read-only` × `--full`:

| Команда | Scope | Behavior | Контекст |
| --- | --- | --- | --- |
| `n-cursor lint` | дельта vs origin | fix | локальний агент (default) |
| `n-cursor lint --read-only` | дельта vs origin | detect | локальний швидкий детект; **pre-commit hook** |
| `n-cursor lint --full` | весь репо | fix | повний локальний аудит (було `lint --ci --fix`) |
| `n-cursor lint --read-only --full` | весь репо | detect | **CI** (було `lint --ci` / `lint-ci`) |

**Реконсиляція з consolidation §5/§8 (потрібно узгодити).** Consolidation вводить третій контекст `--ci` з `effectiveCi`/`{scope,ci}`-override (CI ганяє per-file правила по дельті, full — повністю). Ця спека **схлопує** його у дві ортогональні осі: CI = `--read-only --full` (усе, весь репо, лише детект). Наслідки, які треба внести в consolidation:

- Окремий прапор `--ci` **зникає**; CI кличе `lint --read-only --full`.
- Оскільки CI тепер завжди `--full`, поле-override `meta.json:lint.ci` (напр. `security: {scope:"per-file", ci:"full"}`) **стає зайвим** — кожне правило в CI і так full. `security` спрощується до `"per-file"`.
- Втрата: per-file-оптимізація CI по дельті. Виграш: проста двовісна модель + гарантоване покриття всього репо в read-only (без LLM детект дешевий). **Підтвердити цей трейдоф** при злитті специфікацій.

---

## Уніфікований контракт правила

Розширюємо контракт consolidation (`lint(files, cwd)`) третім аргументом — режимом поведінки:

```js
/**
 * @param {string[]|undefined} files  дельта vs origin (scope=default) або undefined (--full)
 * @param {string} cwd
 * @param {{ readOnly: boolean }} opts
 * @returns {Promise<{ ok: boolean, findings: Finding[] }>}
 */
export async function lint(files, cwd, { readOnly }) { /* ... */ }
```

```ts
type Finding = {
  ruleId: string
  concern: string        // oxlint | knip | policy:manifest | …
  file?: string
  line?: number
  message: string        // «що не так», людинозрозуміло
  fixable: 'auto' | 'llm'  // як закривається (manual немає — все фіксимо)
}
```

- `ok: true` ⇔ `findings: []`.
- **read-only** → `findings` = усе знайдене.
- **fix** → `findings` = **лише невиправний залишок** після Tier0+omlx.

> **Реконсиляція з consolidation §3-З** («сигнатура `lint(files, cwd)` без змін»): ця спека **додає** `opts.readOnly`. Узгодити: контракт стає `lint(files, cwd, { readOnly })`; default `readOnly:false`.

### Concern-модель

Правило = набір **concern-ів**, кожен має `detect()` (обов'язково) і опційно `fixAuto()`:

| Тип concern | Приклад | `detect()` | `fixAuto()` (Tier 0) | Tier 1+ (omlx) |
| --- | --- | --- | --- | --- |
| **external-tool** | oxlint, eslint, cspell, knip, jscpd, stylelint, actionlint, trufflehog | прогін тула без `--fix` → findings | прогін із `--fix` (де є) | LLM править залишок |
| **check (JS)** | `js/<concern>.mjs` `check(ctx)` | findings | детермінований fixer (де є) | LLM закриває залишок |
| **policy (Rego)** | `policy/<concern>/*.rego` через conftest | deny → findings | T0-auto (створення файлу, merge конфігу) | LLM закриває залишок |

Узагальнює дихотомію: `js/lint.mjs` → external-tool concern-и; `fix.mjs`+`check()`+policy → check/policy concern-и. **Усі течуть в один check-gate.**

---

## Семантика `read-only` (== CI, == pre-commit)

1. Для кожного concern — **лише `detect()`**. Жодного `--fix`, жодного запису у ФС, жодного LLM.
2. Вивід — **лише «що не так»**.
3. **Exit 1** при будь-якій знахідці; **exit 0** — чисто. (`--hook`/`--git`-форми — exit 2 за hook-протоколом, як у doc-files.)
4. **Інваріант нуль-мутацій (тестується):** `lint --read-only` на брудному дереві → `git diff` байт-у-байт незмінний.

---

## Семантика `fix` (default, локальний)

Зберігаємо двигун поточного `fix`-оркестратора (`scripts.mdc`) — він стає двигуном fix-режиму:

```
for iter in 1..maxIter (default 3):
    1. Tier 0 — детермінований fix:
       для кожного concern із fixAuto(): застосувати
       (oxlint/eslint/stylelint/markdownlint/ruff --fix, oxfmt,
        Rego T0-auto, створення missing-файлів, cspell dict-add, …)
    2. Check-gate — повторний detect() по всіх concern-ах
       if findings == 0: break
    3. Tier 1+ — omlx-ескалація (local min → avg → max через resolveModel):
       лише для залишку з fixable === 'llm'
       (knip unused, jscpd дублі, cspell одрук, actionlint/zizmor,
        trufflehog-знахідки, складні check-фейли)
       кожен виклик у try/catch; tier-fail → escalate, не крах
    4. Check-gate знову
       if findings == 0: break
if findings != 0: exit 1, вивід — лише залишок
else: exit 0
```

Інваріанти зі `scripts.mdc` **не послаблюємо**: check-gate (закриття лише через повторний `detect()→ok`), escalation ladder, fail-fast локального tier (≤60 с, одна спроба), per-rule serialization через `withLock('lint-<ruleId>')`.

**Точна відповідність пункту 3 (detect-only автофікс):** detect-only тул без `--fix` → знахідка → check-gate бачить як невиправлену → Tier 1+ диспатчить omlx → check-gate підтверджує. Двигун є; під'єднуємо лінтер-concern-и.

---

## omlx-ескалація (заміна хмарної)

Tier 1+ працює на **локальному omlx** (Apple MLX), не на хмарі:

- **Маршрутизація вже готова:** `npm/lib/llm.mjs` за префіксом `omlx/<model>` йде прямим HTTP (`callOmlx`), минаючи `pi`. Тир — через `resolveModel('min'→'avg'→'max')`, каскад **local→cloud** (cloud лише фолбек, якщо локальний тир не задано/недоступний).
- **Існуючий воркер** `npm/skills/fix/js/llm-worker.mjs` уже ходить через `resolveModel('min')`/`resolveModel('avg')` + `callLlm`. Переїзд = задати `N_LOCAL_MIN_MODEL=omlx/…` (і `_AVG`/`_MAX`); код воркера переноситься в новий оркестратор без зміни контракту.
- **Два транспорти Tier 1+** (на розсуд concern-фіксера):
  - **прямі виклики** — `callLlm` (omlx HTTP) повертає текст, воркер застосовує правку (як зараз).
  - **`mimo code`** — агентний код-тул, що сам редагує файли (для багатофайлових/контекстних правок).
- Ескалація `min → avg → max` — у межах локальних omlx-моделей; cloud — лише останній фолбек каскаду.
- Wire-trace (`omlx-trace.mjs`, always-on) фіксує кожен виклик — лишається.

---

## Стратегія автофіксу concern-ів

Класифікація `fixable` визначає Tier 0 vs Tier 1+. **Manual-категорії немає — усе фіксимо** (R-1):

| Concern | `--fix`? | Tier 0 (скрипт) | Tier 1+ (omlx) |
| --- | --- | --- | --- |
| oxlint / eslint / stylelint / markdownlint / ruff | ✅ | `--fix` | залишок |
| oxfmt / dotenv-linter | ✅ | прогін | — |
| shellcheck | ⚠️ | diff+patch | залишок |
| cspell | ❌ | dict-add (відомі терміни) | реальна одрук → rewrite |
| knip | ❌ | — | видалення unused export/dep |
| jscpd | ❌ | — | дедуплікація |
| actionlint / zizmor | ❌ | — | правка/hardening воркфлоу |
| v8r / opa / regal | ❌ | — | правка під схему/Rego |
| **trufflehog** | ❌ | — | **omlx-фікс** (видалення/заміна секрету); знахідка завжди у виводі до закриття |

> **Follow-up (поза цією спекою):** конкретна реалізація кожного Tier 1+ фіксера — окрема задача-наступник. Тут зафіксовано лише класифікацію й те, що двигун їх викликає.

---

## Заміна `n-cursor fix` — повне видалення

| Видаляється | Куди переходить |
| --- | --- |
| `n-cursor fix [rules]` | `n-cursor lint [rules]` (fix-режим) — **без аліасу** |
| `n-cursor fix-t0` | Tier 0 всередині fix-режиму `lint` |
| `n-cursor _fix-check --json` | `n-cursor lint --read-only --json` |
| `skills/fix/js/orchestrator.mjs` | двигун fix-режиму уніфікованого оркестратора |
| `skills/fix/js/llm-worker.mjs` | Tier 1+ (omlx) уніфікованого оркестратора |
| per-rule `fix.mjs` + `check()` + policy | check/policy **concern-и** під `lint`-контрактом |
| `lint-cli.mjs` (`runLint`) | поглинається оркестратором `npm/rules/lint/js/orchestrate.mjs` (consolidation §7) |
| хуки на `fix --json` | перемикаються на `lint --read-only --json` (без compat-shim) |

**Унікальні здатності, що ОБОВ'ЯЗКОВО зберігаємо:** convergence-loop, check-gate, Tier0-детермінізм, omlx-ескалація, Rego/conftest-енфорсмент, template-driven перевірки, per-rule serialization.

---

## Exit codes і JSON

| Code | Значення |
| --- | --- |
| `0` | чисто (немає знахідок / залишок виправлено) |
| `1` | є знахідки (read-only) або невиправний залишок (fix) |
| `2` | hook-форми (`--hook`/`--git`) — blocking feedback (doc-files-конвенція); або внутрішня помилка оркестратора |

JSON (`--json`, заміняє `_fix-check --json`):

```json
{
  "mode": "fix" | "read-only",
  "scope": "delta" | "full",
  "total": 21, "failed": 2,
  "rules": [ { "ruleId": "js-lint", "ok": false, "findings": [ /* Finding[] */ ] } ]
}
```

---

## Паралелізм: знімаємо заборону

**Рішення:** заборону на паралельний `eslint`/`oxlint` **знімаємо** — паралельні прогони по **різних файлах** не конфліктують (контенція була від whole-tree-прогонів, що ділять той самий корпус).

- Оркестратор **МОЖЕ** паралелити external-tool concern-и по **диз'юнктних file-shard-ах** (per-file scope це природно дозволяє).
- **Потребує оновлення governance-документів** (поза кодом цієї спеки, але обов'язкова частина major):
  - `CLAUDE.md` — секція «Лінт і ESLint (без паралельних запусків)» → переписати: паралельно по різних файлах дозволено; серіалізація потрібна лише для whole-tree-прогонів того самого корпусу.
  - `.cursor/rules/scripts.mdc` / `.cursor/skills/n-lint/SKILL.md` — узгодити з новим правилом; зняти безумовну `runStandardLint`-серіалізацію там, де shard-и диз'юнктні.

---

## Scoped check/policy у default-режимі (R-4)

У scope=default (дельта vs origin) **check/policy-concern-и теж scoped по змінених файлах** — не whole-repo. Whole-repo — лише у `--full`. Це вимагає, щоб `check(ctx)`/policy-таргети вміли приймати `files`-фільтр (узгодити з concern-API consolidation).

---

## Скіли

- `/n-lint` — **єдиний** скіл: ганяє `n-cursor lint` (fix за замовчуванням), worktree-only.
- `/n-fix` — **видаляється** (не аліас): scope-розділення «структура vs код» зникає, одна машина закриває обидва.

---

## Pre-commit hook (R-6)

Pre-commit ганяє **лише `lint --read-only`** (дельта vs origin, staged): детермінований, без LLM, без мутацій; exit 1 блокує коміт із переліком «що не так». Жодного автофіксу в pre-commit (не блокувати коміт правками/LLM).

---

## Ризики й відкриті питання

- **O-1 (реконсиляція).** Схлопування consolidation-контексту `--ci` у `--read-only --full` (втрата per-file-CI-оптимізації, зайвість `meta.json:lint.ci`). Підтвердити при злитті специфікацій.
- **O-2.** Розширення контракту `lint(files, cwd)` → `lint(files, cwd, { readOnly })` — узгодити з consolidation §3-З і всіма наявними `lint.mjs`.
- **O-3.** omlx-якість/латентність Tier 1+ на складних фіксах (jscpd-дедуп, zizmor-hardening) vs cloud-фолбек — заміряти; визначити поріг ескалації в cloud.
- **O-4.** `mimo code` як транспорт Tier 1+ — інтеграційний контракт (вхід/вихід, застосування правок, таймаут) — деталізувати в задачі-наступнику фіксерів.

---

## План міграції (phased — major; будується поверх consolidation)

1. **База scope.** Реалізувати spec consolidation (правило `npm/rules/lint/`, `{scope,ci}`, база-origin, три→дві осі). *Передумова.*
2. **Вісь behavior.** Додати `--read-only`/`--full`-прапори й `opts.readOnly` у контракт `lint`; інваріант нуль-мутацій + тест.
3. **Поглинання двигуна.** Перенести convergence-loop/check-gate/Tier0 зі `skills/fix/js/orchestrator.mjs` у `rules/lint/js/orchestrate.mjs`; **видалити** `fix`/`fix-t0`/`_fix-check`.
4. **omlx-ескалація.** Перенести `llm-worker.mjs` у Tier 1+; задати `N_LOCAL_*_MODEL=omlx/…`; cloud — фолбек.
5. **Concern-и.** Мігрувати правила: `js/lint.mjs`→external-tool concern-и (`detect`/`fixAuto`); `fix.mjs`+`check()`+policy→check/policy concern-и; класифікувати `fixable`.
6. **Scoped check/policy (R-4)** + **паралелізм по shard-ах**; оновити `CLAUDE.md`/`scripts.mdc`/`n-lint` SKILL.
7. **Хуки/скіли.** Pre-commit → `lint --read-only`; `/n-fix` видалити; хуки → `lint --read-only --json`.
8. **CI.** Воркфлоу → `n-cursor lint --read-only --full`; перевірити нуль-мутацій у CI.
9. **Фінал.** `bun test` у `npm/`; один `n-cursor lint --full`; change-файли (n-changelog, major).
10. **Follow-up (окрема задача).** Реалізація конкретних per-tool omlx-фіксерів (knip/jscpd/cspell/actionlint/zizmor/v8r/regal/trufflehog).
