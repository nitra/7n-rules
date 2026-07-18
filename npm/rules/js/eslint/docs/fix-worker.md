---
type: JS Module
title: fix-worker.mjs
resource: npm/rules/js/eslint/fix-worker.mjs
docgen:
  crc: 1eb9c7fc
  model: manual
---

## Огляд

Custom fix-worker `js/eslint` (перекриває дефолтний `default-worker.mjs`): замість одного `runAgentFix`-виклику з усіма порушеннями з усіх файлів concern-а — окрема агентна сесія на кожен файл, у межах спільного дедлайну rung-а. Мотивація — виміряно на реальних lint-прогонах: одна сесія, що жонглює кількома файлами одразу, стабільно впирається у timeout на всіх 4 rung-ах драбини (local-min→cloud-avg), навіть при малому обсязі порушень; та сама модель, scoped на один файл, укладається в бюджет і закриває більшість порушень.

## Поведінка

1. Групує вхідні `violations` за `file`; порушення без `file` ігноруються.
2. Дедлайн — `DEADLINE_FRACTION` (0.8) від `ctx.timeoutMs`; цикл перевіряє дедлайн ПЕРЕД стартом кожного файлу і не починає новий, якщо час вичерпано.
3. Кожен файл отримує РЕШТУ бюджету до дедлайну (не фіксований поділ `timeoutMs / files.length`) — перший (часто найважчий) файл отримує найбільше часу.
4. На кожен файл — окремий `runAgentFix` із `targetFiles: [file]` і власним `verify` (`verifyFile`): item-scoped canonical re-detect лише цього файлу, не всього concern-а — інакше evidence-гейт хибно вважав би файл незакритим через порушення в ІНШИХ файлах.
5. Один файл, що завершився з `error`, не обриває цикл — пропускається, наступні файли все одно обробляються в межах дедлайну.
6. Повертає лише `touchedFiles` з успішних (`!error`) викликів; success rung-а все одно визначає whole-concern canonical re-detect runner-а (`runRung`), не цей worker.

## Публічний API

- `fixWorker(violations, ctx)` — контракт `FixWorkerFn`; резолвиться автоматично замість `default-worker.mjs`, бо лежить як `fix-worker.mjs` поруч із `main.mjs` concern-а.

## Гарантії поведінки

- Пише лише у файли з переданих `violations` (`targetFiles: [file]` на кожен виклик) — той самий semantic-collateral guard, що й у дефолтного worker-а.
- `recordWrite` (не durable) на кожен файл: rollback-контракт незмінний — якщо після worker-а в concern-і лишилось хоч одне порушення будь-де, `runRung` відкочує ВСІ правки цього rung-а, включно з уже полагодженими файлами.
