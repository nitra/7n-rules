---
type: JS Module
title: read-n-rules-config-lite.mjs
resource: npm/scripts/lib/read-n-rules-config-lite.mjs
docgen:
  crc: ee4e1c69
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Light read-only `.n-rules.json` reader для standalone `check.mjs`, з fallback на legacy `.n-cursor.json`. Повертає доступний конфіг і лише читає локальний конфіг без auto-rules detection, merge чи schema sync — це лишається за повним `readConfig` у CLI.

`readNRulesConfigLite` читає доступний файл конфіга, а `isRuleEnabled` визначає, чи правило може брати участь у виконанні: без `.n-rules.json` правило вважається enabled за default-open поведінкою; якщо файл є, але правила немає в `rules`, воно не enabled; якщо правило є в `disableRules`, воно не enabled навіть тоді, коли присутнє в `rules`.

## Поведінка

readNRulesConfigLite читає локальний конфіг для запуску перевірок правил у поточному каталозі: спочатку шукає .n-rules.json, а якщо його немає — переходить до .n-cursor.json. Якщо жодного файла немає, повертає стан без конфіга, де правила вважаються відкритими за замовчуванням, щоб standalone перевірки могли працювати з довільної директорії для debug. Коли файл знайдено, з нього беруться лише список дозволених правил, список явно вимкнених правил і, якщо присутній, перелік plugins; решта вмісту не впливає на поведінку цього lite-читача.

isRuleEnabled застосовує ці дані як спільне правило доступу: явне вимкнення має пріоритет над whitelist, а за наявності конфіга правило запускається лише тоді, коли воно присутнє в дозволеному списку. Якщо конфіг відсутній, перевірка повертає дозвіл на запуск без додаткових умов. Результат цієї перевірки визначає, чи має правило брати участь у виконанні, не змінюючи сам конфіг і не залежачи від інших станів.

## Публічний API

- isRuleEnabled — Чи активне правило згідно з конфігом.
  - файл відсутній → true (open by default для debug);
  - правило явно в `disable-rules` → false;
  - правило у `rules` → true;
  - інакше → false.
- readNRulesConfigLite — читає спрощені налаштування правил із `.n-rules.json`, а якщо там немає потрібних даних, бере їх із `.n-cursor.json` для подальшої роботи з конфігурацією.

## Сценарії використання

- `npm/scripts/lib/tests/read-n-rules-config-lite.test.mjs` (readNRulesConfigLite; isRuleEnabled) — повертає exists:false коли файл відсутній; повертає rules, disableRules, exists і plugins з файлу; повертає порожні масиви коли поля відсутні; фільтрує нерядкові елементи з rules; мігрує legacy ci4 у doc-files для runtime readers; ще 4

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
