---
kind: nitra-spec
status: draft
adr: null
plan: ../plans/2026-06-02-flow-trace-relative-links.md
risk: low
---

# trace: резолв лінків відносно артефакту + `flow:` як інфо — дизайн

Дата: 2026-06-02
Власник: @vitaliytv
Статус: Draft (очікує апруву)
Беклог: flow-adaptation-backlog #3

## Проблема (дві окремі)

1. **Резолвинг doc-to-doc.** `trace.mjs` резолвить лінк як `exists(join(root, target))`
   (root-relative), але конвенція доків — **file-relative** (`spec: ../specs/x.md`).
   Тож `join(root, '../specs/x.md')` виходить за межі репо → хибний «РОЗРИВ» на
   КОЖНОМУ коректно злінкованому spec↔plan.
2. **Поле `flow:`** вказує на `.worktrees/<branch>.flow.json` — runtime-стан
   (gitignored, поза `docs/`, існує лише під час задачі). У чистому checkout/CI його
   нема ніколи → гарантований хибний «РОЗРИВ». Це не ланка ланцюга, а вказівник на стан.

Сумарний наслідок — знецінення сигналу: warning горить завжди, тож справжній розрив
(plan → видалений spec) лишиться непоміченим.

## Рішення (Q1=A)

- **Doc-to-doc лінки** (`adr/spec/plan/change/task`) резолвити **відносно теки артефакту**
  з root-relative fallback: лінк `ok`, якщо існує `join(root, dirname(file), target)`
  **або** `join(root, target)`. Обидві конвенції валідні → нуль хибних розривів.
- **`flow:`** показувати у виводі (корисний вказівник на стан задачі), але **не рахувати**
  його існування розривом — це runtime-стан, не doc-артефакт. Розрив ланцюга
  визначають лише chain-поля.

## Зміни секціями

### A. `trace.mjs`

- Розділити поля: `CHAIN_LINK_FIELDS = ['adr','spec','plan','change','task']` (breaking)
  та інформаційні (`flow`). `LINK_FIELDS` лишити для порядку/відображення.
- `analyze(artifacts, resolve)` — `resolve(target, artifactFile) => boolean`. Кожен лінк:
  `{ field, target, ok, breaking }`, де `breaking = field !== 'flow'`.
- `runTraceCli`: `analyze(artifacts, (target, file) => resolveLink(root, file, target, exists))`,
  де `resolveLink` = relative-to-file OR root-relative.
- Exit-код / «є розрив» лише за `breaking && !ok`.
- `render`: для не-breaking нерезолвленого лінка — нейтральний маркер (напр. `~ flow: … (runtime-стан)`),
  не `✗ РОЗРИВ`.

## Тести (`tests/trace.test.mjs`)

- file-relative лінк (`../specs/x.md`) між наявними доками → `ok`, без розриву (раніше падав).
- root-relative лінк (`docs/specs/x.md`) → теж `ok` (fallback).
- справжній розрив (chain-поле на неіснуючий файл) → `ok:false`, exit 1.
- `flow:` на неіснуючий `.flow.json` → показано, `breaking:false`, exit 0 (НЕ розрив).
- мікс: лише `flow` нерезолвлений → exit 0; chain-поле нерезолвлене → exit 1.

## Не-цілі

- Не змінюємо формат front-matter і конвенцію лінкування доків.
- Не чіпаємо інші команди flow (trace викликається через `verifyTrace`, сигнатура та сама).

## Як перевірити

- `bun test` trace — зелений; нові кейси проходять.
- `flow spec`/`flow plan` на коректно злінкованих доках — **без** warning «розрив ланцюга».
- Реальний розрив (видалити цільовий spec) — warning лишається.

## Ризики

Low. Зміна суто в read-only trace; послаблює хибні спрацювання, зберігає детект справжніх розривів.
