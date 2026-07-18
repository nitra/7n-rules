---
type: ADR
title: "cspell-fix: classify→dict-suggest замість whole-file rewrite"
description: LLM-fix для cspell має класифікувати unknown words і дописувати валідні слова у словник замість переписування всього файлу.
---

**Status:** Accepted
**Date:** 2026-06-15

## Context and Problem Statement

`npm/rules/text/lint/cspell-fix.mjs` використовував `llmLintFix`: модель отримувала весь файл і мала повернути виправлений файл назад. На реальних файлах репозиторію такий whole-file rewrite давав timeout 120 секунд (`curl exit 28`) і parse-fail для відповідей, бо output ріс разом із input. Transcript також фіксує, що приблизно 90% `Unknown word` знахідок cspell у цьому репозиторії є валідними українськими словами або технічними термінами, яких бракує у словнику, а не одруками.

## Considered Options

- Classify → авто-дописати валідні слова у `.cspell.json`, typo → список на review без автоматичного застосування.
- Залишити whole-file rewrite з вищим timeout.
- Прибрати LLM з cspell і лишити detect-only.

## Decision Outcome

Chosen option: "Classify → авто-дописати валідні слова у `.cspell.json`, typo → список на review без автоматичного застосування", because whole-file output є unbounded і вже призводив до timeout/parse-fail, тоді як реальний remediation для більшості знахідок у transcript — поповнення словника, а не мутація source-файлів.

### Consequences

- Good, because bounded classify-виклик працює з компактним JSON для обмеженого списку слів і не масштабує output до розміру source-файлу.
- Good, because валідні українські та технічні слова додаються у `.cspell.json`, що відповідає природі більшості cspell-знахідок у transcript.
- Good, because source-файли не переписуються LLM, а ймовірні typo лишаються на review.
- Bad, because classify-виклик може помилитися; transcript фіксує приклад шкідливої класифікації `аутейдж` → `аудит`, тому typo-fix не можна застосовувати автоматично.
- Neutral, because transcript не містить підтвердження, що цей підхід виправляє всі cspell-знахідки без ручного поповнення словника при недоступному `omlx`.

## More Information

- Змінені файли за transcript: `npm/rules/text/lint/cspell-fix.mjs`, `npm/rules/text/lint/tests/cspell-fix.test.mjs`.
- Нові або згадані API: `unknownWords`, `classifyPrompt`, `appendWordsToDict`, `runCspellText`.
- Цільовий словник: `.cspell.json`, поле `words[]`, із sorted і dedup поведінкою.
- Changeset: `npm/.changes/260615-1308.md` з `bump: minor` і `section: Changed`.
- Transcript facts: 1406 cspell-знахідок у 292 файлах; whole-file rewrite давав timeout 120 секунд і parse-fail; bounded classify у живому прогоні додав валідні слова у `.cspell.json` і залишив typo на review.

## Update 2026-06-15

- Transcript уточнює стратегію для cspell: `classify+dict-suggest` замість whole-file patch, бо експеримент показав 1406 cspell-знахідок у 292 файлах, приблизно 90% з яких є валідними українськими або технічними словами, а не одруками.
- Whole-file `llmLintFix` отримував timeout 120с / `curl exit 28` і parse errors на реальних файлах, тоді як compact classify prompt відпрацьовував, але мав ризик хибної класифікації (`аутейдж` → `аудит`), тому typo-fix має лишатися на diff review.
- Додатково зафіксовано майбутній напрям: спільне ядро `llmFixBatch(targets, strategy)` з per-rule `fixOne`, де doc-files має outcome «regenerate artifact», а cspell — outcome «append dictionary suggestions».

## Update 2026-06-15

- Для cspell сформульовано інваріант bounded output: LLM-fix strategy не має повертати весь вхідний файл, бо це створює timeout/parse-fail на великих файлах.
- Нова форма cspell-fix: `unknownWords(output)`, `appendWordsToDict(words, cfgPath)`, `runCspellText(files, cwd, {readOnly})`; словник `.cspell.json` має оновлювати `words[]` із sorted+dedup.
- Scope для cspell-fix за transcript — quick-only на змінених файлах; ймовірні одруки не застосовуються автоматично, а виводяться на review.

## Update 2026-06-15

- Додатковий transcript факт: після classify→dictionary прогону re-detect на scope став зеленим; імовірні одруки були виведені на review без auto-apply.
- Драфт фіксує, що при `omlx` down cspell findings лишаються і потребують ручного додавання слів або повторного запуску з доступною локальною моделлю.
- Спеку `docs/specs/2026-06-15-opportunistic-llm-fix-tier.md` у цій сесії оновити не вдалося через permission block, тому вона залишилась у Draft-стані.
