# Opportunistic LLM-fix tier для lint-правил — дизайн-спека

Дата: 2026-06-15
Власник: @vitaliytv
Статус: Draft — measured ✅ (експеримент на цьому репо, 2026-06-15). Реалізовано: doc-files (apply-форма), cspell (suggest-форма). Лишилось: винос спільного preflight у `lib/llm.mjs`.

## Мотивація

doc-files — єдине lint-правило, чий _fix_ недетермінований і зовнішньо-залежний (генерація доків через локальну LLM omlx), тому його `lint()`-крок свідомо вироджений у **detect-only + delegate** (`→ npx @nitra/cursor fix-doc-files`). Решта правил у fix-by-default реально правлять (oxlint `--fix`, конформність-конвергенція).

Ідея: зробити doc-files **референсом** загального патерну — будь-яке правило, виявивши порушення, яке не правиться детерміновано, може **опортуністично** виправити його локальною моделлю (якщо omlx піднято), інакше — пропустити з повідомленням і не зеленити гейт. Приклад другого інстансу: `cspell`-друкарки (cspell не має `--fix`; модель може виправити друкарку в коментарі/рядку).

Це **поширення** наявного механізму: conformance-фаза вже має сходинку «check → Tier0 (детермінований) → omlx (LLM)» (`runConformance`, лише `--full`). Спека опускає цю сходинку на per-file scan-рівень як reusable-цеглину.

## Результати виміру (cspell, 2026-06-15)

Експеримент на цьому репо (worktree-ізоляція): cspell дає **1406 знахідок / 292 файли**, з них ~90% — **валідні укр/тех-терміни** (`chdir`, `pgdump`, `instrumenter`, `аддонів`, `плагіна`, `лінтингу`…), не одруки. Порівняли три підходи:

|                  | (a) whole-file LLM-apply (старий `cspell-fix`) | (b) classify → словник                  | (c) detect-only    |
| ---------------- | ---------------------------------------------- | --------------------------------------- | ------------------ |
| Працює на репо   | ❌ 120с-таймаути, memory-guard, parse-fail     | ✅ 1 bounded виклик                     | ✅                 |
| Безпека          | мутує код (ризик)                              | пропонує (нуль мутацій коду)            | safe               |
| Влучає в природу | ні (лікує одруки, яких майже нема)             | **так** (валідні → словник)             | нуль автоматизації |
| Результат        | ~0 фіксів, гейт червоний                       | +79 валідних → `.cspell.json` за прогін | ручна тріаж        |

**Висновок:** (b) виграє. Це задало **дві outcome-форми** і **принцип bounded output** нижче.

## Принцип: bounded output

> Стратегія мусить давати **bounded** LLM-вихід. «Apply через перепис усього входу» — заборонений анти-патерн (старий cspell-fix просив модель виплюнути весь файл як JSON → output ∝ розмір файлу → таймаут).

Латентність авторегресивної LLM визначається к-стю **output**-токенів. Тому валідні форми:

- **apply (generate bounded artifact)** — doc-files: output = док (по секціях, не джерело), незалежно від розміру входу → timeout-safe;
- **suggest (emit bounded suggestions)** — cspell: output = малий JSON-вердикт класифікації; застосування — детерміноване дописування у `.cspell.json` (не через LLM);
- (майбутнє) line/range-патчі — обмежені к-стю знахідок, **не** whole-file.

## Контракт кроку (`rules/<id>/js/lint.mjs`)

```
lint(files, cwd, { readOnly }):
  v = detect(files, cwd)
  if v.empty:          return 0
  if readOnly:         return report(v)            # CI/hook — детермінований гейт, 0 LLM, 0 мутацій
  if not rule.llmFix:  return report(v)            # правило не позначене llm-fixable → як зараз
  problem = preflightProblem()                     # omlx health-check ЛИШЕ коли є порушення
  if problem:          report(v, skipped=problem)  return 1   # omlx down → skip, гейт тримається
  await llmFix(v, files, cwd)                       # opportunistic fix через спільний хелпер
  return report(detect(files, cwd))                 # re-detect: 0 якщо все полагоджено
```

Інваріанти (без них патерн небезпечний):

1. **`readOnly` (CI/hook) — завжди detect-only.** Жодних мутацій/LLM. Детермінований, відтворюваний гейт.
2. **`skip → exit 1`.** Машина без omlx ніколи не дає false-green на порушенні. «Не зміг полагодити зараз» = багатша причина fail, як «не-авто-фіксоване порушення» в oxlint.
3. **health-check лише коли є порушення.** Чисте дерево не платить omlx-пробою.

Це консистентно з наявною fix-by-default семантикою: фіксоване порушення → pass (після мутації); нефіксоване зараз → fail.

## Тріаж безпеки (критично для «на всі правила»)

LLM, що переписує вихідний код заради _логічного_ лінтера, може **змінити поведінку**, не лише стиль. Тому патерн — **opt-in per-rule**, а не суцільний:

| Клас                      | Правила                                                         | LLM-fix    | Чому                                                                           |
| ------------------------- | --------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------ |
| **Контент (безпечно)**    | doc-files (проза), text/cspell (друкарки в коментарях/рядках)   | ✅         | Зміни в людському тексті/документації; диф очевидний, ризик поведінки ~0       |
| **Структурне (обережно)** | markdownlint-залишки, dotenv                                    | ⚠️ пізніше | Низький ризик, але детермінований `--fix` зазвичай уже покриває                |
| **Логічне (небезпечно)**  | oxlint/eslint (`no-unused-vars`, complexity), style-lint логіка | ❌         | LLM-правка може тихо змінити семантику; лишити детермінований `--fix` + людину |

Прапор: `meta.json: { "llmFix": true }` (default `false`). Тільки явно позначені правила отримують opportunistic-сходинку.

## Спільна цеглина (рішення)

**Рішення D1 (одна абстракція):** спільне — це не одна монолітна функція, а **спільне ядро + per-rule стратегія**. Після виміру виявилось, що loop-форми **різні**: doc-files = батч генерацій із circuit-breaker (`runGenerationBatch`), cspell = **один** bounded classify-виклик (per-target loop не потрібен — output і так малий). Тому штучно зводити їх в один цикл шкідливо.

**Реально спільне (виносимо в `npm/lib/llm.mjs`):**

- `preflightLocalModel(model)` → `problem|null` — omlx health-check (memory-guard / down / auth). Зараз дубльований: `docgen-files-batch.preflightProblem` + `cspell-fix.preflightProblem` → один хелпер.
- **Рішення D2 (єдиний knob):** модель — `N_LOCAL_MIN_MODEL` усюди (прибрано `N_CURSOR_FIX_MODEL` із cspell-шляху).

**Стратегія-специфічне (лишається у правилі):**

- doc-files: `runGenerationBatch(targets, root)` (preflight + per-target loop + breaker) — apply-форма;
- cspell: `runCspellText` (preflight + один classify + дописування у `.cspell.json`) — suggest-форма.

**Рішення D4 (один opt-in):** `meta.json: { "llmFix": true }` (boolean) для обох; форму (apply/suggest) знає сама стратегія правила.

## Вплив на тести (вартість, яку приймаємо)

Перенесення генерації в `lint()` забирає **герметичність** юніт-тестів детектора: зараз `lint(files, root)` (без `readOnly`) чистий; після зміни з виставленим `N_LOCAL_MIN_MODEL` він робив би реальний omlx-виклик. Тому:

- наявні detect-тести (`rules/doc-files/js/tests/lint.test.mjs`) перевести на `lint(files, root, { readOnly: true })`;
- gating-логіку (skip-on-down, fix-on-up) тестувати з мок-`preflightProblem`/`runGenerationBatch`.

## Розгортання

1. **doc-files (референс) — ✅ зроблено.** `runGenerationBatch`/`preflightProblem` витягнуто; `meta.json: llmFix:true`; `js/lint.mjs` переписано за контрактом (apply-форма); тести на `{readOnly:true}` + gating-моки.
2. **text/cspell (2-й інстанс) — ✅ зроблено (suggest-форма).** Старий whole-file `cspell-fix` замінено на classify → `.cspell.json`; preflight + cap; `unknownWords`/`appendWordsToDict` + тести. (Whole-file apply був операційно зламаний — див. «Результати виміру».)
3. **Спільний preflight у `lib/llm.mjs` — наступне.** Винести `preflightLocalModel(model)`, замінити обидва локальні `preflightProblem`. Loop/breaker лишаються у doc-files (cspell — single-call).
4. **Решта правил — лише після (3)**, суворо за тріажем. Логічні лінтери **не** вмикати без окремого рішення.

## Відкриті питання

- Hook-ефект: PostToolUse `fix`-шлях на кожне збереження з піднятим omlx авто-генеруватиме/виправлятиме — бажано (doc/spell-on-save) чи дратує? Можливо, hook лишити detect-only, а opportunistic-fix — лише на явному `lint` (не readOnly).
- cspell scope: наразі `cspell .` (весь репо) з cap'ом класифікації (80 слів/прогін, конвергує за прогони). Можливо, звузити до quick-scope (змінені файли) для `lint` без `--full`.
