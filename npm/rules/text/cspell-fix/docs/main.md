---
type: JS Module
title: main.mjs
resource: npm/rules/text/cspell-fix/main.mjs
docgen:
  crc: c1e7c7b7
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 75
---

## Огляд

cspell у ланцюжку lint-text із omlx-класифікацією (нова схема — спека
docs/specs/2026-06-15-opportunistic-llm-fix-tier.md).

cspell не має нативного `--fix`, а емпірично ~90% «Unknown word» на укр+тех-репо —
валідні терміни, не одруки (вимір: 1406 знахідок / 292 файли, ~90% словникові
кандидати). Тому fix-режим НЕ переписує файли (старий whole-file `llmLintFix`
таймаутив/парс-фейлив — bounded-output принцип спеки), а **класифікує** знахідки:
  detect → omlx-класифікація distinct-слів (bounded JSON-вихід) → валідні слова
  авто-дописуються у `.cspell.json#words` (sorted/dedup, видно в diff) → ймовірні
  одруки лишаються списком на рев'ю (НЕ авто-виправляються — апплай небезпечний) →
  re-detect. Класифікація виконується у `fix-worker.mjs` (Central Runner Pipeline);
  тут — лише read-only детект і shared-хелпери класифікації.

Гейт: валідні слова після дописування у словник зникають; нерозкласифіковані та
typo лишаються → cspell повертає !=0 → exit 1 (людина доправляє одруки вручну).

## Публічний API

- MAX_CLASSIFY_WORDS — Максимум distinct-слів під класифікацію за прогін (без тихого обрізання — логуємо надлишок).
- fixModel — Preferred fix-модель з universal fallback від local-min до cloud-max.
- detectCspell — Запускає `cspell` над `files` (delta) або над `.` (full), захоплюючи вивід. Скоуп файлів, які
cspell реально перевіряє, і так визначає сам `.cspell.json` (globs/ignorePaths) — переданий
`files` лише звужує аргументи CLI, не дублює цю логіку. Без `verbose` вимикає власний
per-file прогрес-репортер cspell (`--no-progress`), щоб не засмічувати `lint --full`; підсумковий
рядок (`--no-summary` НЕ передається) лишається — з нього парситься `FILES_CHECKED_RE`.
- unknownWords — Унікальні «Unknown word» зі stdout cspell.
- classifyPrompt — Промпт класифікації: для укр+тех-репо bias у «valid» (додати валідне слово безпечно,
«виправити» валідне — шкода). Вихід bounded — JSON-масив вердиктів.
- parseClassify — Витягує JSON-масив із відповіді моделі (бере від першої «[» до останньої «]» — зрізає прозу й markdown-обрамлення).
- appendWordsToDict — Дописує слова у `.cspell.json#words` (sorted/dedup) — видно в git diff для рев'ю.
- runCspellText — cspell-крок lint-text: read-only детект (нуль мутацій). LLM-класифікація знахідок
і поповнення `.cspell.json#words` живуть у `fix-worker.mjs` (Central Runner Pipeline).
Async (не блокує event loop) — детектор може виконуватись у parallel lane `detectAll()`
(ADR 260716-1354).
- lint — Detector text/cspell-fix: read-only cspell по `ctx.files` (delta) або по всьому репо (full).
Скоуп файлів, які реально перевіряються, керується `.cspell.json` (glob/ignorePaths) — тут
лише звужуємо аргументи CLI до `ctx.files`, коли вони задані.

## Сценарії використання

- `npm/rules/text/cspell-fix/tests/cspell-fix-unit.test.mjs` (cspell-fix unit policy) — fixModel делегує universal resolver від local-min selector; classifyPrompt містить усі слова й bounded JSON contract; detectCspell формує quiet/verbose args і нормалізує відсутній exitCode; detectCspell трактує Files checked: 0 як чистий результат; runCspellText fail-closed без npx; ще 4
- `npm/rules/text/cspell-fix/tests/cspell-fix.test.mjs` (unknownWords; appendWordsToDict) — витягує distinct-слова з виводу cspell; порожній вивід → []; дописує нові слова у .cspell.json#words (sorted/dedup), повертає к-сть доданих; порожній список або відсутній конфіг → 0; файл повністю в ignorePaths (Files checked: 0) → code:0, не порушення; ще 1

## Гарантії поведінки

- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
