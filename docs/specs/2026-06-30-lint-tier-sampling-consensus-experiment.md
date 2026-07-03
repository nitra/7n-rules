# Lint fix tier sampling / consensus experiment

Дата: 2026-06-30
Власник: @vitaliytv
Статус: Completed 2026-07-02 — рішення зафіксовано у [experiment results](2026-07-02-lint-tier-sampling-consensus-results-spec.md)
Пов'язано: [unified lint surface](2026-06-29-unified-lint-surface.md), [pi fix-engine migration](2026-06-26-pi-fix-engine-migration.md), [experiment results](2026-07-02-lint-tier-sampling-consensus-results-spec.md)

## Мета

Перевірити, на якому model tier доречно застосовувати кілька LLM-candidates із різними sampling-профілями і optional consensus/judge-кроком.

Це експериментальний документ. Він не міняє production ladder unified lint surface і не додає нову роль у fix pipeline.

## Початкова гіпотеза

- `local-min` — не місце для consensus за замовчуванням: локальний inference повільний, а додаткові samples часто множать noise. Корисний baseline і retry з feedback.
- `cloud-min` — найкращий кандидат для cheap dual-sampling: достатньо швидкий, щоб перевірити `conservative` vs `exploratory` без стрибка одразу в дорожчу модель.
- `cloud-avg` — кандидат для hard cases і advisory judge, але не blanket best-of-N для кожного порушення.
- `cloud-max` — experiment-only last-resort / judge tier. Він не входить у default ladder і не промотується без даних по cost/rescue rate.

## Межа з production ladder

Production ladder за замовчуванням лишається one candidate per rung:

```txt
local-min -> local-min-retry -> cloud-min -> cloud-avg
```

`cloud-max` не додається у `FixContext#tier` і production ladder до завершення експерименту. Якщо його промотити, треба окремо оновити `FixContext`, tier helpers, avg/max budget і telemetry schema.

Експериментальні тири:

```js
/**
 * @typedef {'local-min' | 'cloud-min' | 'cloud-avg' | 'cloud-max'} ExperimentTier
 */
```

## Sampling profiles

`samplingProfile` належить central runner / pi adapter, не concern worker-у.

Якщо provider підтримує `temperature`, профілі можуть мапитись так:

- `conservative`: provider default або low temperature;
- `exploratory`: higher temperature;
- `judge`: no write tools, deterministic / low temperature.

Якщо provider не має стабільного temperature API, experiment все одно валідний: diversity можна отримувати prompt-варіантом, іншим `thinkingLevel` або іншим tier-ом. У trace треба писати фактичні sampling knobs, які реально пішли в provider payload.

## Методика

Для кожного fixture-а / concern-а / tier-а:

1. Відновити `S1` перед кожною candidate-спробою.
2. Запустити baseline: один `conservative` attempt.
3. Запустити experiment: два ізольовані candidates — `conservative` і `exploratory`.
4. Після кожного candidate-а виконати canonical detect; LLM не вирішує success.
5. Якщо один candidate clean — вибрати його.
6. Якщо кілька candidates clean — вибрати менший diff / менше touched files / дешевший wall-time.
7. Якщо жоден candidate не clean — optional judge може повернути тільки feedback для наступного rung-а, але не може override-ити detector.
8. Фінальний verdict завжди робить canonical detect на вибраному candidate patch.

Consensus/judge не є success oracle. Він лише обирає clean candidate або формує feedback.

## Метрики

- clean rate після canonical detect;
- rescue rate: baseline failed, experiment clean;
- false-clean rate: має бути `0`, бо detector є oracle;
- wall-time p50/p95;
- tokens / cost;
- touched files і diff size;
- rollback count;
- regression count у downstream tests, якщо concern має test command.

## Promotion rule

- dual-sampling можна вмикати для tier-а тільки якщо rescue rate покриває додаткову вартість і не погіршує p95 latency сильніше, ніж перехід на наступний tier;
- `cloud-max` може стати production rung-ом тільки під окремим max-cap і після доказу, що він дешевший за ручне втручання на залишкових hard cases;
- consensus/judge ніколи не стає success oracle.
