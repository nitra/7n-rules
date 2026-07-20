---
type: ADR
title: "Мінімальна поверхня CLI @nitra/cursor: видалення lint-ci і doc-files"
description: CLI має прибрати надлишкові alias-команди lint-ci і doc-files <sub>, залишивши прямі lint, lint-doc-files та fix-doc-files сценарії.
---

**Status:** Accepted
**Date:** 2026-06-15

## Context and Problem Statement

CLI `n-cursor` накопичив надлишкові точки входу: `lint-ci` був alias для `lint --read-only --full`, а `doc-files <sub>` — deprecated-аліас до нових doc-files команд. Transcript фіксує, що живих callerів для цих alias-команд у workflow, root `package.json` або скілах не знайдено.

## Considered Options

- Видалити `lint-ci` і використовувати `lint --read-only --full` для CI.
- Злити doc-files-виклики у спеціальний флаг `--doc-files` до `lint`.
- Залишити alias-команди для зворотної сумісності.

## Decision Outcome

Chosen option: "Видалити `lint-ci` і `doc-files <sub>`", because transcript фіксує ціль мінімальної CLI-поверхні, нуль живих callerів і відсутність у alias-команд власної поведінки.

### Consequences

- Good, because зменшується кількість публічних точок входу та шляхів до одного результату.
- Good, because CI-сценарій явно виражається як `lint --read-only --full`.
- Bad, because видалення публічних команд є breaking change для зовнішніх скриптів, якщо вони викликали alias напряму; transcript не містить підтверджених живих callerів.

## More Information

Зафіксовані файли: `npm/bin/n-cursor.js`, `npm/schemas/rule-meta.json`, `npm/rules/js-lint-ci/js-lint-ci.mdc`. Для doc-files лишаються ролі: `lint` як локальна delta-латка або перевірка залежно від режиму, `lint-doc-files` як hook-протокол, `fix-doc-files` як bulk/overwrite/retry-degraded інструмент. Перевірки з transcript: `node --check npm/bin/n-cursor.js` — OK; orchestrator vitest — 6/6 passed.

## Update 2026-06-15

Додатково зафіксовано виправлення схеми `npm/schemas/rule-meta.json`: поле `lint` мало enum `['quick', 'ci']`, тоді як runtime-код `parseRuleLintSpec` і оркестратор використовували `per-file` та `full`. Рішення: оновити enum на `['per-file', 'full']`, бо старі значення були залишком попереднього рефакторингу.

Перевірки з transcript: `node --check npm/bin/n-cursor.js` — OK; JSON schema прочитано через `JSON.parse` — OK; orchestrator vitest — 6/6 passed.

## Update 2026-06-15

Окремо підтверджено, що `lint-ci` був чистим alias для `runLint({ full: true, readOnly: true })`. Видалення охоплює `case 'lint-ci'` у `npm/bin/n-cursor.js`, згадку в шапці CLI та рядок у `default`-помилці.

Для doc-files зафіксовано контракт ролей: `lint-doc-files` / lint-крок виконують detect/fail-fast, а `fix-doc-files` відповідає за генерацію через локальну LLM. Deprecated `doc-files <sub>` підтверджено мертвим за caller-ами й винесено в план видалення як breaking change.

## Update 2026-06-19

- Колишній сценарій `fix <rule>` замаплено на позиційні фільтри `lint <rule>`.
- `npm/bin/n-cursor.js` у `case 'lint'` трактує позиційні non-flag аргументи як фільтр правил конформності, наприклад `lint changelog`.
- Міграція викликів: `fix changelog` → `npx @nitra/cursor lint changelog`; fix по дельті → `npx @nitra/cursor lint`; fix по всьому repo → `npx @nitra/cursor lint --full`.
- Transcript фіксує прийнятий breaking change: окрема підкоманда `fix` більше не є потрібною CLI-поверхнею.
