---
type: JS Module
title: runtime-probe.mjs
resource: plugins/lang-js/coverage-provider/lib/runtime-probe.mjs
docgen:
  crc: 688620f5
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`probeModule`, `probeFetchCalls`, `probeTimeVariants` і `probeHelpers` дають runtime-перевірку експортів і допоміжних функцій, щоб зафіксувати їхні реальні форми результатів, фактичні `fetch`-виклики через перехоплення `globalThis.fetch`, а також відгук на часові варіанти `[0,9,14,22]`. `describeShape` і `capProbeOutput` зводять отримані значення до коротшого, читабельного вигляду для порівняння. Усі probe-стратегії працюють best-effort: помилки не виходять назовні, а за певних збоїв повертається порожнє значення на кшталт `{}` або `null`.

## Поведінка

describeShape використовує лише вже розпарсене значення як вхід і зводить його до стислого опису форми, який далі підхоплюють capProbeOutput, capModuleResults і capHelperResults для безпечного скорочення надто великих результатів.

capProbeOutput є центральним обмежувачем для серіалізованих probe-даних: короткі значення проходять без змін, а довгі замінюються на shape-summary, щоб downstream-споживачі бачили структуру, але не тягнули повний дамп у промпт або expected.

probeModule запускає експортовані значення в окремому процесі, збирає фактичні outputs і пропускає їх через capModuleResults; якщо під час probing щось ламається, повертає порожній результат замість помилки.

probeFetchCalls ізольовано перехоплює globalThis.fetch і збирає реальні URL та init, які формує кожен export; результат також fail-safe і не піднімає винятки назовні.

probeTimeVariants проганяє exports у кількох годинах доби й повертає лише ті, чий вихід змінюється залежно від часу, щоб виявляти time-sensitive поведінку без ручного перегляду всіх запусків.

probeHelpers працює з неекспортованими helper-ами: бере source-модуля, витягує top-level helper-и, проганяє їх через generic param combos і через capHelperResults зводить надто великі результати до безпечного вигляду; як і інші probe-потоки, при будь-якій помилці повертає порожній об’єкт.

## Публічний API

- describeShape — Рекурсивно описує форму значення без самих даних.
- capProbeOutput — Обмежує серіалізований probe-вихід: до `PROBE_OUTPUT_MAX_CHARS` — без змін,
  довший — shape-summary замість значення (модель бачить структуру для
  asserts на форму, але не тягне дамп у промпт і не копіює його в expected).
- probeModule — Пробує експорти модуля у дочірньому процесі й повертає фактичні виходи.
- probeFetchCalls — Перехоплює `fetch` і збирає реальні URL/init, які будує кожен export.
- probeTimeVariants — Запускає кожен export у кількох годинах доби й повертає time-sensitive варіанти.
- probeHelpers — Витягує неекспортовані helper-и з source та проганяє їх крізь generic param combos.
  Best-effort: повертає `{}` при будь-якій помилці.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
