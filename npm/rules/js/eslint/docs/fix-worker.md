---
type: JS Module
title: fix-worker.mjs
resource: npm/rules/js/eslint/fix-worker.mjs
docgen:
  crc: 802ef1f3
  model: manual
---

## Огляд

Custom fix-worker `js/eslint` (перекриває дефолтний `default-worker.mjs`): замість одного `runAgentFix`-виклику з усіма порушеннями з усіх файлів concern-а — окрема агентна сесія на кожен файл, ПАРАЛЕЛЬНО (обмежений пул, не більше `MAX_PARALLEL_FILES`). Мотивація й еволюція дизайну — `docs/adr/260718-0754-js-eslint-fix-worker-per-session-overhead.md`: послідовна версія стабільно впиралась у timeout на всіх 4 rung-ах драбини (local-min→cloud-avg); профайлінг реального прогону показав, що домінує кількість/довжина раундів моделі на файл, а не фіксовані bootstrap-витрати сесії — тож паралелізм (кілька файлів одночасно замість черги) дає пряме пришвидшення незалежно від причини.

## Поведінка

1. Групує вхідні `violations` за `file`; порушення без `file` ігноруються.
2. Дедлайн — `DEADLINE_FRACTION` (0.8) від `ctx.timeoutMs`; гейтить лише СТАРТ нового файлу з черги (не скасовує вже запущені).
3. `runPooled` — обмежений пул воркерів (`MAX_PARALLEL_FILES=4`): при `files.length ≤ MAX_PARALLEL_FILES` усі файли стартують майже одночасно й отримують практично весь бюджет незалежно один від одного; при більшій кількості черга природно звужує бюджет пізніших хвиль (`callTimeoutMs` рахується в момент старту файлу з черги, не наперед).
4. На кожен файл — окремий `runAgentFix` із `targetFiles: [file]` і власним `verify` (`verifyFile`): item-scoped canonical re-detect лише цього файлу, не всього concern-а — інакше evidence-гейт хибно вважав би файл незакритим через порушення в ІНШИХ файлах.
5. Один файл, що завершився з `error` АБО кинув виняток (try/catch у тілі воркера), не обриває пул — пропускається, решта файлів обробляються незалежно.
6. Повертає лише `touchedFiles` з успішних (`!error`) викликів; success rung-а все одно визначає whole-concern canonical re-detect runner-а (`runRung`), не цей worker.

## Публічний API

- `fixWorker(violations, ctx)` — контракт `FixWorkerFn`; резолвиться автоматично замість `default-worker.mjs`, бо лежить як `fix-worker.mjs` поруч із `main.mjs` concern-а.

## Гарантії поведінки

- Пише лише у файли з переданих `violations` (`targetFiles: [file]` на кожен виклик) — той самий semantic-collateral guard, що й у дефолтного worker-а.
- `recordWrite` (не durable) на кожен файл: rollback-контракт незмінний — якщо після worker-а в concern-і лишилось хоч одне порушення будь-де, `runRung` відкочує ВСІ правки цього rung-а, включно з уже полагодженими файлами.
- Конкурентні виклики `recordWrite` безпечні: central snapshot — синхронні Map-операції без `await` усередині, event loop не перериває їх посеред виконання.
