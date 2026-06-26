---
type: JS Module
title: llm-worker.mjs
resource: npm/scripts/lib/fix/llm-worker.mjs
docgen:
  crc: 5d019a98
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
---

## Огляд

Модуль виділяє унікальні відносні шляхи файлів, пов'язаних із порушеннями, та виконує LLM-виклик для виправлення одного rule-порушення. Підтримує вибір sub-check `.mdc` за конкретним target-файлом — замість повного `n-{id}.mdc` передає моделі лише релевантну секцію правила (1–2 KB замість 20+ KB).

## Поведінка

`extractFilePaths` витягує унікальні відносні шляхи файлів із violation output, пріоритетно розбираючи рядки ❌ (файли що потребують фіксу), потім generic-regex для контексту. Розуміє workspace-prefix `[npm] path/file.ext → npm/path/file.ext`.

`selectSubCheckMdc` читає `policy/<concern>/target.json` з каталогу `npm/rules/{ruleId}/` пакету, знаходить concerns із `files.single`, що відповідають failing-файлам із violation output, і повертає конкатенацію відповідних `.mdc`. Повертає `null` якщо правило не має policy-підкаталогу або жоден concern не збігається з ❌-файлами.

`runLlmWorker` спочатку викликає `selectSubCheckMdc` — і якщо отримує match, передає моделі лише той sub-check `.mdc`. Якщо match немає — fallback на повний `n-{id}.mdc`. Далі читає файли з violation output, будує prompt, викликає LLM через `callLlmRich` і застосовує зміни.

## Публічний API

`extractFilePaths(output)` — повертає унікальні відносні шляхи файлів з violation output (❌-рядки першими).

`runLlmWorker(ruleId, violationOutput, projectRoot, opts)` — виправляє одне порушення правила через LLM. Повертає `{ ok, error?, changes, diagnosis, reasoning, reasoningSource, promptSummary }`. `promptSummary.subCheckMdc: boolean` вказує чи використано точковий sub-check замість повного mdc.

## Гарантії поведінки

- Читає `policy/` безпосередньо з пакету (`import.meta.dirname/../../../rules/`), без pre-generation файлів.
- Fallback на повний `n-{id}.mdc` при: відсутності policy-підкаталогу, `walkGlob`-таргетах, відсутності ❌-файлів у violation, нульовому match.
- Перехоплює всі помилки LLM і повертає структурований `{ ok: false, error }`.
