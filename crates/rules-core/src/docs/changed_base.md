---
type: Rust Module
title: changed_base.rs
resource: crates/rules-core/src/changed_base.rs
docgen:
  crc: f2dc6bb5
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 80
---

## Огляд

Точний порт `resolveChangedBase` з `npm/scripts/lib/changed-files.mjs:63-82` (задача T3 фази 1, `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`).  # П1 — merge-base у gix 0.86  Верифіковано: `gix::Repository::merge_base` (feature `revision`, тягне `index`; плюс `sha1` для object-hash backend) доступний у пін 0.86 і покриває і `git merge-base <a> <b>`, і `--is-ancestor a b` (останнє — `merge_base(a, b) == a`, той самий трюк, що й голий git: ancestor-check через merge-base без окремого API). Porcelain-межа (`std::process::Command`) тут НЕ знадобилась — на відміну від `mt-core/src/git/compat.rs`, де вона покриває capability, яких немає в gix узагалі.  # Семантика (parity з JS)  JS-версія (`mergeBaseWith` у changed-files.mjs) ковтає будь-яку помилку git (ref не існує, не резолвиться, немає HEAD, не git-репо) і повертає `''`/`null` — ніколи не кидає. Rust-порт дзеркалить це: усі негаразди резолву зводяться до `None`/пропуску кандидата; [`RulesError::Git`] лишається лише для випадків, які в JS не могли статись у принципі (наразі — жодних; сигнатура повертає `Result` про запас під майбутні use case-и gix-запитів, що можуть провалитись «по-справжньому»).  # Shallow-репо — тимчасова porcelain-межа  Виявлений parity-розрив (A4): на shallow-клоні (`git clone --depth 1 --no-single-branch`) голий `git merge-base` бачить `.git/shallow` — межові коміти позначені як «без батьків», тож traversal, що впирається в межу раніше спільного предка, падає з ненульовим exit-кодом і дореформений JS повертав `null` (fail-closed: consumer-CI з `fetch-depth: 1` краще лишити без scope, ніж помилково звузити його). `gix::Repository::merge_base` (пін 0.86) shallow-межу НЕ пильнує: traversal іде звичайним object-graph і доходить до предка, якщо той фізично лежить в локальному object-store (наприклад, притягнутий через іншу гілку при `--no-single-branch`), — тобто повертає sha там, де голий git мовчки здається. Для consumer-CI це небезпечніше за стару поведінку (реальний scope замість fail-closed «немає scope»), тож приймати розходження не можна.  Рішення — детектувати shallow (`Repository::is_shallow()`, завжди доступний у 0.86, без додаткових features) і на shallow-репо рахувати merge-base/is-ancestor НЕ через gix, а через вузьку porcelain-межу (`std::process::Command` виклики `git merge-base`, за зразком `mt-core/src/git/compat.rs` — «дозволена capability, якої бракує pinned-крейту», не загальний exec-API). Це свідомо тимчасово, до shallow-aware traversal у майбутній версії gix; non-shallow шлях лишається чистим gix (швидше, без subprocess).

## Публічний API

- resolve_changed_base — Визначає git base для scoped-перевірок — Rust-порт `resolveChangedBase` (changed-files.mjs:63-82).  - `base_ref` заданий: результат — merge-base між `HEAD` і цим ref, або `None`; `candidates` ігноруються (як у JS). - інакше: по кожному з `candidates` (уже розгорнутий список `origin/<name>`/`<name>` — розгортання policy лишається в JS, Р5) рахуємо merge-base з `HEAD`, відкидаємо порожні; серед знайдених sha беремо «найновіший» — перший, що не є предком жодного пізнішого кандидата, ітеративно замінюється кандидатом, якщо є предком нього.  Повертає повний 40-символьний hex sha (як `git merge-base` на друк).

## Гарантії поведінки

- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
