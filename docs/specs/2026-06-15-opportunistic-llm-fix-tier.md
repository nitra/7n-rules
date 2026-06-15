# Opportunistic LLM-fix tier для lint-правил — дизайн-спека

Дата: 2026-06-15
Власник: @vitaliytv
Статус: Draft

## Мотивація

doc-files — єдине lint-правило, чий *fix* недетермінований і зовнішньо-залежний (генерація доків через локальну LLM omlx), тому його `lint()`-крок свідомо вироджений у **detect-only + delegate** (`→ npx @nitra/cursor fix-doc-files`). Решта правил у fix-by-default реально правлять (oxlint `--fix`, конформність-конвергенція).

Ідея: зробити doc-files **референсом** загального патерну — будь-яке правило, виявивши порушення, яке не правиться детерміновано, може **опортуністично** виправити його локальною моделлю (якщо omlx піднято), інакше — пропустити з повідомленням і не зеленити гейт. Приклад другого інстансу: `cspell`-друкарки (cspell не має `--fix`; модель може виправити друкарку в коментарі/рядку).

Це **поширення** наявного механізму: conformance-фаза вже має сходинку «check → Tier0 (детермінований) → omlx (LLM)» (`runConformance`, лише `--full`). Спека опускає цю сходинку на per-file scan-рівень як reusable-цеглину.

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

LLM, що переписує вихідний код заради *логічного* лінтера, може **змінити поведінку**, не лише стиль. Тому патерн — **opt-in per-rule**, а не суцільний:

| Клас | Правила | LLM-fix | Чому |
|---|---|---|---|
| **Контент (безпечно)** | doc-files (проза), text/cspell (друкарки в коментарях/рядках) | ✅ | Зміни в людському тексті/документації; диф очевидний, ризик поведінки ~0 |
| **Структурне (обережно)** | markdownlint-залишки, dotenv | ⚠️ пізніше | Низький ризик, але детермінований `--fix` зазвичай уже покриває |
| **Логічне (небезпечно)** | oxlint/eslint (`no-unused-vars`, complexity), style-lint логіка | ❌ | LLM-правка може тихо змінити семантику; лишити детермінований `--fix` + людину |

Прапор: `meta.json: { "llmFix": true }` (default `false`). Тільки явно позначені правила отримують opportunistic-сходинку.

## Спільна цеглина

Витягти з `npm/rules/doc-files/js/docgen-files-batch.mjs` ядро «preflight + loop з circuit-breaker + report» (наразі інлайн у `runDocFilesGenCli`, рядки ~217-249) в експортовану `runGenerationBatch(targets, root)`; `runDocFilesGenCli` стає тонкою обгорткою (scan → selectTargets → `runGenerationBatch`). `preflightProblem()` теж експортувати. Для не-doc-files правил — узагальнити в `npm/lib/llm.mjs` хелпер `llmFixBatch({ violations, files, cwd, promptFor })`, що ділить health-check/abort-streak/таймінги з docgen.

## Вплив на тести (вартість, яку приймаємо)

Перенесення генерації в `lint()` забирає **герметичність** юніт-тестів детектора: зараз `lint(files, root)` (без `readOnly`) чистий; після зміни з виставленим `N_LOCAL_MIN_MODEL` він робив би реальний omlx-виклик. Тому:
- наявні detect-тести (`rules/doc-files/js/tests/lint.test.mjs`) перевести на `lint(files, root, { readOnly: true })`;
- gating-логіку (skip-on-down, fix-on-up) тестувати з мок-`preflightProblem`/`runGenerationBatch`.

## Розгортання

1. **doc-files (референс).** Витягти `runGenerationBatch`/`preflightProblem`; `meta.json: llmFix:true`; переписати `js/lint.mjs` за контрактом; оновити тести; перегенерувати CRC-доки. Перевірити обидва шляхи (omlx up/down).
2. **text/cspell (другий інстанс, валідація абстракції).** Узагальнити хелпер у `lib/llm.mjs`; cspell-friendly промпт (виправ друкарку, не міняй ідентифікатори/API); `meta.json: llmFix:true` для text лише на cspell-підкроці.
3. **Решта — лише після (1)+(2)**, суворо за тріажем. Логічні лінтери **не** вмикати без окремого рішення.

## Відкриті питання

- Hook-ефект: PostToolUse `fix`-шлях на кожне збереження з піднятим omlx авто-генеруватиме/виправлятиме — бажано (doc/spell-on-save) чи дратує? Можливо, hook лишити detect-only, а opportunistic-fix — лише на явному `lint` (не readOnly).
- Чи варто обмежити opportunistic-fix лише quick-scope (змінені файли), щоб `lint --full` не запускав важку LLM по всьому репо ненавмисно.
