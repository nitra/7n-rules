---
type: JS Module
title: ci-artifact-consumer.mjs
resource: plugins/ci-azure/slots/ci-artifact-consumer.mjs
docgen:
  crc: 68401129
---

Generic consumer слоту `ci.artifact@1` для `@7n/rules-ci-azure` (spec `2026-07-27-universal-plugin-slots-lang-php-extraction`, §7.3). Перевіряє Azure Pipelines lint-кроки будь-якого language-плагіна — без жодного PHP чи іншого мовного literal у цьому пакеті.

## Поведінка

`mergeStrategy: "contains-step"` — на відміну від GitHub-adapter-а (structural deep merge) тут перевіряється лише наявність канонічного lint-кроку десь у дереві (`steps`/`jobs`/`stages` на будь-якій глибині — топологія Azure pipeline вкладена довільно: `stages[].jobs[].steps[]`, `jobs[].steps[]`, голий `steps[]`). Канонічна команда (з `template`) АБО загальний full-lint (`n-rules lint --no-fix --full` / `@7n/rules lint --no-fix --full`, той самий provider-level fallback, що вже є у чинному `lint_pipeline_php.rego`) — обидва варіанти покривають concern; обов'язковий read-only marker `--no-fix` десь у тому самому script-блобі.

`template` — YAML з одним полем `script` (canonical command БЕЗ `--no-fix`, напр. `n-rules lint php`); provider сам конструює `n-rules <cmd>`/`@7n/rules <cmd>` варіанти — бінарний префікс лишається provider-know-how, не частиною descriptor-а.

1. **`loadCanonicalCommand(contribution, descriptor)`** резолвить безпечний шлях `template`, читає й парсить `{ script }`.
2. **`diagnoseArtifact({ cwd, targetPath, command })`** обходить весь document tree (`collectScripts`), збирає всі `script`-поля в один текстовий рядок і перевіряє наявність canonical/fallback маркера та `--no-fix`. Файл відсутній → `{ applicable: false, violations: [] }` (`patch-existing`-семантика: pipeline-файл належить окремому концерну, spec §7.1).

v1 — diagnostic-only: модуль не експортує T0 apply-функцію (`fix: false` у payload).

## Публічний API

`loadCanonicalCommand` — читає й парсить canonical-команду з template одного artifact-у.
`diagnoseArtifact` — діагностує наявність canonical/fallback lint-кроку й `--no-fix`.
Default export — `loadSlotConsumer`-сумісний `{ id: 'ci-azure-artifact', validate(payload) }`; `validate` додатково вимагає `mergeStrategy: "contains-step"` і `fix: false`.

## Гарантії поведінки

* **Будь-яка глибина**: `collectScripts` обходить ВЕСЬ document tree рекурсивно, не покладаючись на конкретні ключі (`steps`/`jobs`/`stages`).
* **Fallback завжди доступний**: загальний full-lint команда приймається замість domain-specific — окремий per-domain крок не обов'язковий.
* **Diagnostic-only**: жодного T0-фіксу в v1 — лише violation-повідомлення.
