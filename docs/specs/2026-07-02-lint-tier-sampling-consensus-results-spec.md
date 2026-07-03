# Spec: lint tier sampling / consensus experiment results

Дата: 2026-07-02
Статус: Completed experiment
Пов'язано:

- [lint tier sampling / consensus experiment](2026-06-30-lint-tier-sampling-consensus-experiment.md)
- [unified lint surface](2026-06-29-unified-lint-surface.md)
- [raw JSON result](2026-06-30-lint-tier-sampling-consensus-results.json)
- [human-readable run report](2026-06-30-lint-tier-sampling-consensus-results.md)

---

## Мета

Зафіксувати результат experiment-only перевірки: чи варто додавати multi-candidate
sampling / consensus у lint fix ladder і на якому tier-і це доречно.

Цей документ є рішенням за результатами прогону. Він не змінює production ladder і не
промотує `cloud-max` у default pipeline.

## Методика

Експеримент запускав isolated candidates поверх реального `runPiAgentFix`, але поза
production `runFixPipeline`.

Перевірені fixtures:

- `package-script-no-fix` — у `package.json` треба прибрати заборонений `--fix` з lint script.
- `missing-jscpd-config` — треба створити валідний `.jscpd.json` з required policy fields.

Перевірені tiers:

| Tier | Candidates | Model | Thinking level |
| --- | --- | --- | --- |
| `local-min` | `conservative` | `omlx/gemma-4-e4b-it-OptiQ-4bit` | `low` |
| `cloud-min` | `conservative`, `exploratory` | `openai-codex/gpt-5.4-mini` | `medium` |
| `cloud-avg` | `conservative`, `exploratory` | `openai-codex/gpt-5.5` | `high` |
| `cloud-max` | `conservative` | `openai-codex/gpt-5.5` | `xhigh` |

У цьому прогоні `cloud-max` і `cloud-avg` використовували ту саму модель: єдина
конфігураційна різниця tier-а — `thinkingLevel` (`xhigh` проти `high`) і один candidate
замість двох.

Кожен candidate стартував із того самого snapshot `S1`. Після кожного candidate-а
виконувався canonical detect. Judge/consensus не був success oracle і не міг зробити
failed candidate успішним.

### Фактичні sampling knobs

Provider payload у цьому прогоні мав лише два knobs: `model` і `thinkingLevel`
(tier-канон: `local-min` → `low`, `cloud-min` → `medium`, `cloud-avg` → `high`,
`cloud-max` → `xhigh`). Temperature не задавався.

Диверсифікація `conservative` vs `exploratory` була **prompt-only**: обидва candidates
одного tier-а йшли на той самий model із тим самим `thinkingLevel`, відрізнявся один
рядок інструкції у ruleText. Тобто dual-sampling подвоював cloud calls заради майже
ідентичного розподілу.

Trace прогону цих knobs не записував (`samplingProfile` відновлюється лише з
`caller`-рядка) — це порушення вимоги experiment-спеку. Виправлено в harness після
прогону: trace тепер містить `thinkingLevel` (пишеться в `runPiAgentFix`, на джерелі
payload-а) та `samplingProfile`/`candidateId` (дописує bench-runner).

## Результати

| Tier | Fixtures clean | Attempts | Clean attempts | Avg attempt |
| --- | ---: | ---: | ---: | ---: |
| `local-min` | 2/2 | 2 | 2/2 | 12.204s |
| `cloud-min` | 2/2 | 4 | 4/4 | 11.977s |
| `cloud-avg` | 2/2 | 4 | 4/4 | 12.949s |
| `cloud-max` | 2/2 | 2 | 2/2 | 9.722s |

Усі 12 attempts завершились clean після canonical detect. Це підтверджує, що harness
коректно ганяє tiers/candidates і rollback між candidates не протікає.

Водночас rescue signal не з'явився: `local-min` закрив обидва fixtures, тому не було
baseline failure, який могли б врятувати `cloud-min`, `cloud-avg`, `cloud-max` або
dual-sampling.

### Tokens і вартість

| Tier | Attempts | Input | Output | Cache read | Total tokens | Avg/attempt |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `local-min` | 2 | 492 | 65 | 4 096 | 4 653 | 2 326 |
| `cloud-min` | 4 | 1 415 | 131 | 6 144 | 7 690 | 1 922 |
| `cloud-avg` | 4 | 4 324 | 159 | 3 072 | 7 555 | 1 889 |
| `cloud-max` | 2 | 2 243 | 88 | 1 536 | 3 867 | 1 934 |

Застереження: у цьому прогоні `telemetry.usage` містив usage лише **останнього** turn-а
attempt-а, тож числа — нижня межа. Виправлено в harness після прогону
(`aggregateUsage` сумує всі turns); наступний прогін дасть повні значення.

`cost.total = 0` в усій телеметрії — це не дефект обліку: `omlx` — локальна модель із
явним cost 0, а `openai-codex` — вбудований pi-провайдер без per-token ціни
(subscription-based, маржинальна вартість $0). Тому грошова метрика для цієї драбини
беззмістовна; бюджетна валюта рішень — **кількість cloud calls і tokens**. Головний
вимірюваний ефект dual-sampling у цьому прогоні: подвоєння cloud calls
(4 attempts замість 2 на tier) без приросту clean rate.

## Інтерпретація

`cloud-min` і `cloud-avg` dual-sampling не покращили clean rate на цьому наборі, бо clean
rate уже був 100%. Вони лише збільшили кількість LLM calls: 2 attempts на fixture замість
1. З огляду на prompt-only диверсифікацію (див. «Фактичні sampling knobs») другий cloud
call за ціною повної спроби купував майже нульову різноманітність — це самостійний
аргумент проти dual-sampling незалежно від rescue rate.

Selection не завжди обирає найшвидший attempt. Це очікувано: chooser ранжує clean
candidates за меншою кількістю touched files, меншим patch size і лише потім за latency.
Наприклад, у `missing-jscpd-config / cloud-min` швидший exploratory candidate програв
conservative candidate-у через більший patch.

`cloud-max` був найшвидшим за average attempt у цьому малому прогоні, але не показав
унікальної якості. Порівняння коректне лише з conservative-attempts `cloud-avg`
(та сама модель, той самий профіль): ~11.1s проти ~9.7s на n=2 — в межах шуму;
avg `cloud-avg` 12.949s тягне вгору повільний exploratory-attempt (19.336s). Без hard
failures швидкість `cloud-max` не є достатньою підставою додавати новий production rung.

## Рішення

Не вмикати dual-sampling by default у production lint fix ladder за результатами цього
прогону.

Не додавати `cloud-max` у production ladder. Він лишається experiment-only tier.

Зберегти production ladder як one candidate per rung:

```txt
local-min -> local-min-retry -> cloud-min -> cloud-avg
```

Зберегти принцип: success визначає тільки canonical detect. Consensus/judge може бути
тільки selector/feedback mechanism, але не oracle.

## Умови промоції

Dual-sampling можна розглядати для `cloud-min` або `cloud-avg`, якщо наступний прогін на
важчих fixtures покаже:

- candidates відрізняються реальними payload knobs (`thinkingLevel`, model або
  temperature, якщо provider його підтримує), а не лише рядком промпта — інакше другий
  cloud call не купує різноманітності й забороняється by design;
- non-zero rescue rate: baseline candidate failed, second candidate clean;
- rescue rate виправдовує додатковий model call;
- p95 latency не гірша за просту ескалацію на наступний tier;
- false-clean rate лишається 0, бо final verdict робить canonical detect.

`cloud-max` можна розглядати тільки як capped last-resort rung для hard cases, якщо він
покаже кращий rescue/cost профіль за ручне втручання або за повторний `cloud-avg`.

## Наступний експеримент

Поточні fixtures занадто прості. Для вимірювання rescue-value потрібні fixtures, де
baseline справді може впасти:

- multi-file edit із залежністю між файлами;
- misleading first patch, який створює degraded або incomplete state;
- fixture з історичного lint failure;
- rule, де correct fix потребує читати template/policy і зберегти unrelated user changes;
- case, де smaller patch і faster patch конфліктують, щоб перевірити chooser policy.

Ключова метрика наступного прогону: rescue rate per extra call, а не clean rate на вже
простих violations.
