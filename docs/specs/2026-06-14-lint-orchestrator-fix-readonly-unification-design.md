# Spec: Уніфікація lint-оркестратора — fix-by-default + `--read-only`, заміна `n-cursor fix`

**Дата:** 2026-06-14
**Статус:** Draft
**Тип:** Major (breaking) — змінює публічний CLI-контракт і per-rule контракт правил

---

## Проблема

Сьогодні в проєкті **дві окремі машини**, що частково дублюють одна одну й мають різні ментальні моделі:

1. **`lint`-світ** — прогін зовнішніх code-quality тулів (oxlint, eslint, jscpd, knip, cspell, stylelint, actionlint, zizmor, trufflehog…). Оркестратор: `npm/scripts/lint-cli.mjs`. Контракт правила: `npm/rules/<id>/js/lint.mjs` → `lint(files, cwd)`. Прямий прогін без циклу. Тули, що вміють `--fix`, **завжди** кличуться з `--fix` — навіть у CI, де мутувати дерево не можна.

2. **`fix`-світ** — конформність конфігів/файлів/воркфлоу через **convergence-loop + check-gate + Tier0(детермінований)→LLM(haiku→sonnet)**. Оркестратор: `npm/skills/fix/js/orchestrator.mjs`. Контракт правила: `fix.mjs` + `check()`-concerns + Rego-policy. Має повноцінний двигун ітеративного виправлення.

Наслідки розриву:

- **Немає осі fix vs read-only.** У CI лінт або мутує дерево (`--fix` завжди ввімкнений), або немає чистого «лише детект». Це некоректно для CI (CI має падати, а не правити).
- **Detect-only тули нічого не фіксять.** knip/jscpd/cspell/actionlint/zizmor лише репортять — користувач править руками, хоча двигун LLM-ескалації **вже існує** в `fix`-світі, просто не під'єднаний до лінтерів.
- **Два контракти, два оркестратори, два скіли** (`/n-lint` і `/n-fix`) на одну по суті задачу «привести проєкт у відповідність».
- **Частина правил має lint без fix, частина — fix без lint.** Немає єдиної точки входу «перевір і виправ правило X».

**Ключове спостереження.** Двигун `fix` (Tier0 → check-gate → LLM-ескалація) — це рівно та машина, якої потребує автофікс detect-only тулів. Лінтер-тули мають стати **ще одними concern-ами**, що годують той самий check-gate. Тоді `n-cursor fix` не видаляється — його **двигун стає fix-режимом нового `lint`**.

---

## Цілі

1. **Одна вісь поведінки:** `lint` за замовчуванням **і детектить, і виправляє** (fix-режим); прапор `--read-only` залишає **лише детект** без жодних мутацій.
2. **Один оркестратор, один per-rule контракт.** Кожне правило виставляє єдину lint-здатність; зовнішні тули, `check()`-concerns і Rego-policy — це **concern-и** під цим контрактом.
3. **Detect-only тули отримують автофікс** — детермінованим скриптом, де можливо (Tier 0), або LLM, де скрипт неефективний (Tier 1+). Через наявний двигун convergence-loop.
4. **CI ⇒ read-only автоматично.** Жодних мутацій дерева в CI; жодного LLM в CI; падіння при будь-якій знахідці.
5. **`n-cursor fix` замінюється** цим оркестратором: його двигун, check-gate, Tier0-auto і LLM-ескалація переходять у fix-режим `lint`. Старий `fix` лишається делегувальним аліасом до наступного major.
6. **Усі правила отримують lint** — навіть ті, що раніше мали лише fix або лише lint. Уніфікуємо точки виклику на один оркестратор.
7. **Output дає лише «що не так»** — і в read-only, і в fix (у fix — лише невиправний залишок).

---

## Не в цьому spec

- Конкретні per-tool LLM-фіксери для кожного detect-only тула (knip/jscpd/cspell…) — їхня реалізація йде окремими задачами; тут лише **стратегія й таблиця класифікації**.
- Видалення legacy-команд `lint-ga`/`lint-js`/`lint-text`/`lint-rego` і старого `fix` — окремий крок наступного major (тут лише план депрекації).
- Зміна формату Rego-policy чи `target.json` — concern-модель лишається як є.

---

## Дві ортогональні осі

Уніфікований оркестратор має дві незалежні осі:

| Вісь | Значення | Що визначає | Джерело |
| --- | --- | --- | --- |
| **Scope** (обсяг) | `quick` \| `ci`(all) | які файли перевіряти | `meta.json` `lint` + git diff |
| **Behavior** (поведінка) | `fix` (default) \| `read-only` | мутувати чи лише детектити | прапор `--read-only` / CI-контекст |

- `quick` — лише змінені файли (`git diff --name-only HEAD` + untracked), для локальної розробки.
- `ci`(all) — увесь репо, включно з крос-файловими аналізаторами (jscpd, knip).
- `fix` — Tier0(детермінований) → check-gate → LLM-ескалація; виправляє максимум, падає на невиправному залишку.
- `read-only` — лише детект, **нуль мутацій**, нуль LLM; падає на будь-якій знахідці.

**Правило зчеплення:** CI-входи (`lint-ci`, GA-воркфлоу) **завжди** виставляють `read-only`. Локальний `lint` за замовчуванням `fix`+`quick`. Осі незалежні: можливі всі чотири комбінації, але CI фіксує `read-only`.

| Команда | Scope | Behavior |
| --- | --- | --- |
| `n-cursor lint` | quick | fix |
| `n-cursor lint --read-only` | quick | read-only |
| `n-cursor lint --ci` (або `lint-ci`) | all | **read-only (форсовано)** |
| `n-cursor lint --ci --fix` | all | fix (локальний повний автофікс, не для CI) |

---

## Уніфікований контракт правила

Кожне checkable-правило виставляє **одну** lint-здатність:

```js
/**
 * @param {string[]|undefined} files  змінені файли (quick) або undefined (all)
 * @param {string} cwd
 * @param {{ readOnly: boolean }} opts
 * @returns {Promise<{ ok: boolean, findings: Finding[] }>}
 */
export async function lint(files, cwd, { readOnly }) { /* ... */ }
```

```ts
type Finding = {
  ruleId: string
  concern: string        // який concern знайшов (oxlint | knip | policy:manifest | …)
  file?: string
  line?: number
  message: string        // «що не так» — людинозрозуміло
  fixable: 'auto' | 'llm' | 'manual'  // як це закривається
}
```

- `ok: true` ⇔ `findings: []`.
- У **read-only** `findings` — усе знайдене.
- У **fix** `findings` — **лише невиправний залишок** після Tier0+LLM.

### Concern-модель

Правило складається з **concern-ів**, кожен — одного з трьох типів. Concern має `detect()` (обов'язково) і опційно `fixAuto()`:

| Тип concern | Приклад | `detect()` | `fixAuto()` (Tier 0) | Tier 1+ (LLM) |
| --- | --- | --- | --- | --- |
| **external-tool** | oxlint, eslint, cspell, knip, jscpd, stylelint, actionlint, trufflehog | прогін тула без `--fix`, парс виводу → findings | прогін тула з `--fix` (де є) | LLM править залишок (де `--fix` нема або не закрив) |
| **check (JS)** | `js/<concern>.mjs` `check(ctx)` | повертає findings | детермінований fixer, якщо існує | LLM закриває залишок |
| **policy (Rego)** | `policy/<concern>/*.rego` через conftest | deny-правила → findings | T0-auto (створення файлу, merge конфігу) | LLM закриває залишок |

Це узагальнює поточну дихотомію: `js/lint.mjs` стає external-tool concern-ами; `fix.mjs`+`check()`+policy стають check/policy concern-ами. **Усі вони течуть в один check-gate.**

---

## Семантика `read-only` режиму (== CI)

Контракт жорсткий:

1. Для кожного правила, для кожного concern — **лише `detect()`**. Жодного `--fix`, жодного запису у ФС, жодного LLM-виклику.
2. Агрегуємо всі `findings`. Вивід — **лише «що не так»** (без шуму про те, що пройшло).
3. **Exit 1**, якщо є хоч одна знахідка; **exit 0** — чисто.
4. **Гарантія нуль-мутацій (інваріант, тестується):** прогін `lint --read-only` на брудному дереві → `git diff` після прогону **байт-у-байт незмінний**.

Це режим, у якому CI-воркфлоу (`lint-doc.yml`, `lint-js.yml`, …) ганяють перевірку: детермінований, без LLM, без правок, падає на порушенні.

---

## Семантика `fix` режиму (default, локальний)

Зберігаємо двигун поточного `fix`-оркестратора (`scripts.mdc` → «КОНТРАКТ ОРКЕСТРАТОРА») без послаблень — він стає двигуном fix-режиму:

```
for iter in 1..maxIter (default 3):
    1. Tier 0 — детермінований fix:
       для кожного concern із fixAuto(): застосувати
       (oxlint --fix, eslint --fix, stylelint --fix, markdownlint --fix,
        ruff --fix, oxfmt, Rego T0-auto, створення missing-файлів,
        cspell dict-add, …)
    2. Check-gate — повторний detect() по всіх concern-ах
       if findings == 0: break
    3. Tier 1+ — LLM-ескалація (haiku → sonnet після ESCALATE_AFTER=2):
       лише для залишку з fixable ∈ {llm}
       (knip unused export, jscpd дублі, cspell реальна одрук,
        actionlint/zizmor правки воркфлоу, складні check-фейли)
       кожен виклик у try/catch; tier-fail → escalate, не крах
    4. Check-gate знову
       if findings == 0: break
if findings != 0: exit 1, вивід — лише залишок
else: exit 0
```

Інваріанти зі `scripts.mdc`, які **не послаблюємо**:

- **Check-gate.** Одиниця закриття = повторний `detect()` дає `ok: true`. Модель «не може вважати себе готовою».
- **Escalation ladder** `local → haiku → sonnet`; tier-fail (maxTurns/ETIMEDOUT/будь-яка помилка) — ескалація, не крах.
- **Fail-fast локаль:** локальний tier ≤60 с і одна спроба.
- **Per-rule serialization** через `withLock('lint-<ruleId>')` — одне правило не переписують паралельно.

**Точна відповідність пункту 4 (detect-only автофікс):** detect-only тул, що не вміє `--fix`, у fix-режимі дає знахідку → check-gate бачить її як невиправлену → Tier 1+ диспатчить LLM, який закриває її → check-gate підтверджує. Двигун уже є; ми лише під'єднуємо лінтер-concern-и до нього.

---

## Стратегія автофіксу detect-only тулів (пункт 4)

Класифікація `fixable` per concern — визначає, що йде в Tier 0, що в Tier 1+, а що **ніколи не автофікситься** (лишається `manual` і завжди у виводі як residue):

| Concern | `--fix` нативний? | Tier 0 (скрипт) | Tier 1+ (LLM) | Примітка |
| --- | --- | --- | --- | --- |
| oxlint | ✅ | `--fix` | залишок | |
| eslint | ✅ | `--fix` | залишок | **без паралельних прогонів** |
| stylelint | ✅ | `--fix` | залишок | |
| markdownlint-cli2 | ✅ | `--fix` | залишок | |
| ruff | ✅ | `--fix` | залишок | |
| oxfmt | ✅ (форматер) | прогін | — | |
| shellcheck | ⚠️ (diff+patch) | patch | залишок | |
| dotenv-linter | ✅ | `--fix` | — | |
| cspell | ❌ | dict-add для відомих термінів | реальна одрук → LLM-rewrite | словник vs одрук — рішення Tier1 |
| knip | ❌ | — | видалення unused export/dep → LLM | |
| jscpd | ❌ | — | дедуплікація → LLM | потенційно великий рефактор |
| actionlint | ❌ | — | правка воркфлоу → LLM | |
| zizmor | ❌ | — | hardening воркфлоу → LLM | |
| v8r | ❌ | — | правка json/yaml під схему → LLM | |
| opa check / regal | ❌ | — | правка Rego → LLM | |
| **trufflehog** | ❌ | — | **НІКОЛИ (manual)** | секрет не «фіксять» автоматично — рішення людини (ротація/видалення); завжди residue, exit 1 |

**Відкрите рішення (R-1):** перелік `manual`-concern-ів, які навіть у fix-режимі ніколи не торкаємо LLM-ом (мінімум — trufflehog/security). Потребує підтвердження.

---

## Exit codes і JSON-вивід

| Code | Значення |
| --- | --- |
| `0` | чисто (немає знахідок / весь залишок виправлено) |
| `1` | є знахідки (read-only) або невиправний залишок (fix) — вивід лише «що не так» |
| `2` | внутрішня помилка оркестратора (не пов'язана зі знахідками) |

JSON-контракт (для скілів/CI; заміняє `_fix-check --json`):

```json
{
  "mode": "fix" | "read-only",
  "scope": "quick" | "all",
  "total": 21,
  "failed": 2,
  "rules": [
    { "ruleId": "js-lint", "ok": false, "findings": [ /* Finding[] */ ] }
  ]
}
```

Прапор `--json` лишає в stdout лише цей об'єкт.

---

## Зміни в `meta.json`

- `lint: "quick" | "ci"` **лишається** — селектор scope-фази (як зараз).
- **Усі checkable-правила** (мають js-concerns або policy-concerns) тепер беруть участь у `lint`. Якщо `lint`-поле відсутнє — дефолт `ci` (повний прогін), бо правило все одно має concern-и.
- Прибираємо потребу окремого «fix-участь»: участь у fix-режимі = участь у lint (одна машина).
- (Опційно, R-2) поле `lintQuickConcerns` / маркер «ci-only concern» — щоб важкі крос-файлові concern-и (jscpd, knip) не ганялись у `quick`. Зараз це робить розділення js-lint/js-lint-ci; треба вирішити, чи переносити в поле concern-а.

---

## Заміна `n-cursor fix` — мапа переходу

| Сьогодні (`fix`-світ) | Після уніфікації |
| --- | --- |
| `n-cursor fix [rules]` | `n-cursor lint [rules]` (fix-режим) — `fix` стає делегувальним аліасом |
| `n-cursor fix-t0` (Tier0-auto) | Tier 0 всередині fix-режиму `lint` |
| `n-cursor _fix-check --json` | `n-cursor lint --read-only --json` |
| `skills/fix/js/orchestrator.mjs` (convergence-loop) | двигун fix-режиму уніфікованого оркестратора |
| `skills/fix/js/llm-worker.mjs` (haiku→sonnet) | Tier 1+ уніфікованого оркестратора |
| per-rule `fix.mjs` + `check()` + policy | check/policy **concern-и** під `lint`-контрактом |
| `lint-cli.mjs` (`runLint`) | поглинається уніфікованим оркестратором; external-tool concern-и |
| `js/lint.mjs` → `lint(files, cwd)` | мігрує на `lint(files, cwd, { readOnly })` |

**Унікальні здатності, що ОБОВ'ЯЗКОВО зберігаємо:** convergence-loop, check-gate, Tier0-детермінізм, LLM-ескалація (haiku→sonnet), Rego/conftest-енфорсмент, template-driven перевірки, per-rule serialization.

---

## Скіли

- `/n-lint` стає **єдиним** скілом: ганяє `n-cursor lint` (fix-режим за замовчуванням), worktree-only, серіалізований (без паралельних eslint).
- `/n-fix` — депрекований; його SKILL.md стає тонким аліасом, що делегує на `/n-lint`, до наступного major.
- Scope-розділення з SKILL.md (`/n-fix` = структура, `/n-lint` = код) **зникає** — одна машина закриває обидва.

---

## CI-воркфлоу

- Усі lint-воркфлоу (`lint-js.yml`, `lint-doc.yml`, `lint-ga.yml`, …) ганяють `n-cursor lint --ci` (== `read-only` + `all`).
- Гарантія: нуль мутацій, нуль LLM, детермінований exit 1/0. CI **не** править дерево — лише падає з переліком «що не так».

---

## Критичне обмеження: заборона паралельного eslint/oxlint

Зі `CLAUDE.md`: `eslint`/`oxlint`/`lint` **не можна** запускати паралельно — ні між собою, ні в кількох процесах/агентах/shell-сесіях. Конкурентний eslint перевантажує диск/CPU і дає нестабільні результати.

**Вимоги до оркестратора:**

- External-tool concern-и (особливо eslint/oxlint/stylelint) виконуються **строго послідовно**, один прогін на сесію.
- При написанні implementation plan: оркестратор **не** розбивати на паралельні субагенти для лінтер-кроків.
- Rule-conformance concern-и (check/policy) можна паралелити **між** правилами, але eslint/oxlint-concern-и — ніколи.
- Per-rule `withLock` + глобальний lint-lock на eslint/oxlint-фазу.

---

## Ризики й відкриті питання

- **R-1.** Перелік `manual`-concern-ів, що ніколи не автофіксяться навіть у fix-режимі (мінімум trufflehog/security). Підтвердити.
- **R-2.** Куди переносити «ci-only concern» (jscpd/knip), щоб вони не ганялись у `quick`: поле concern-а vs збереження js-lint/js-lint-ci розділення.
- **R-3.** LLM у локальному `lint` — недетермінований і повільний. Tier 0 лишається дефолтним швидким шляхом; LLM-tier спрацьовує **лише** на залишку. Чи потрібен прапор `--no-llm` для суто-детермінованого локального fix? (ймовірно так — для швидкого pre-commit.)
- **R-4.** Scope check/policy-concern-ів у `quick`: історично вони ганяються по всьому репо. Визначити — scoped по змінених файлах чи whole-repo навіть у quick.
- **R-5.** Зворотна сумісність споживачів `n-cursor fix --json` (скіли, хуки `post-tool-use-fix.mjs`) — аліас має зберегти JSON-формат на час депрекації.
- **R-6.** Pre-commit хук: який режим? Імовірно `lint --fix` (швидкий Tier0, `--no-llm`) на staged-файлах, щоб не блокувати коміт LLM-ом.

---

## План міграції (phased — major)

1. **Фаза 1 — двигун.** Винести двигун `fix`-оркестратора в уніфікований `lint`-оркестратор; ввести вісь `--read-only` і per-rule контракт `lint(files, cwd, { readOnly })`. Старі `fix`/`lint`/`lint-ci` — делегувальні аліаси на новий оркестратор. Гарантія нуль-мутацій у read-only — з тестом-інваріантом.
2. **Фаза 2 — concern-и.** Мігрувати кожне правило: `js/lint.mjs` → external-tool concern-и з `detect()`/`fixAuto()`; `fix.mjs`+`check()`+policy → check/policy concern-и під єдиним контрактом. Класифікувати `fixable` per concern (таблиця вище).
3. **Фаза 3 — detect-only автофікс.** Під'єднати Tier 1+ LLM-фіксери для knip/jscpd/cspell/actionlint/zizmor/… за таблицею стратегії.
4. **Фаза 4 — CI.** Перевести воркфлоу на `lint --ci` (read-only). Перевірити нуль-мутацій у CI.
5. **Фаза 5 — скіли.** `/n-lint` єдиний; `/n-fix` депрекований аліас.
6. **Фаза 6 (наступний major) — прибирання.** Видалити legacy `fix`, `fix-t0`, `_fix-check`, старі `lint-*` скрипти й split lint.mjs/fix.mjs; зняти аліаси.

---

## Зворотна сумісність

- `n-cursor fix [rules]`, `fix-t0`, `_fix-check --json` — делегувальні аліаси з незмінним JSON-форматом до major-прибирання (Фаза 6).
- Кореневі `lint-ga`/`lint-js`/`lint-text`/`lint-rego`/`lint-style`/`lint-python` — лишаються робочими аліасами на час переходу.
- Хуки (`post-tool-use-fix.mjs`) перемикаються на новий оркестратор без зміни зовнішнього контракту.
