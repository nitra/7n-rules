---
type: JS Module
title: ci-artifact-collect.mjs
resource: npm/scripts/lib/ci-artifact-collect.mjs
docgen:
  crc: 67c74b0e
---

Спільний collect+collision helper для generic `ci.artifact@1` consumer-ів (spec `2026-07-27-universal-plugin-slots-lang-php-extraction`, §7.2, §7.3, §9.10). `@7n/rules-ci-github` і `@7n/rules-ci-azure` потребують ідентичний collect+collision-контракт, розрізняючись лише `targetCapability`-фільтром — provider-specific diagnose/fix лишається у кожного consumer-а окремо.

Окремий файл від `slot-contracts-ci.mjs` — навмисно: цей модуль читає slot graph (`plugin-slots.mjs`), який сам імпортує `plugin-api.mjs`; `plugin-api.mjs` re-експортує payload-контракт з `slot-contracts-ci.mjs`. Якби graph-читання жило в `slot-contracts-ci.mjs`, вийшов би import-цикл `plugin-api → slot-contracts-ci → plugin-slots → plugin-api`. Тому цей модуль НЕ ре-експортується через `@7n/rules/plugin-api` — плагіни імпортують його напряму через `@7n/rules/scripts/lib/ci-artifact-collect.mjs`.

## Поведінка

1. **`collectCiArtifactContributions(cwd, targetCapability)`** читає `.n-rules.json` (`readNRulesConfigLite`), резолвить slot graph (`resolveSlotGraph`) і бере всі `ci.artifact@1` contributions (`getSlotContributions`). Для кожної contribution читає й валідує payload (`loadCiArtifactPayload` + `validateCiArtifactPayload`); невалідні/нечитабельні payload потрапляють у `errors`. Валідні contributions, чий `targetCapability` збігається з переданим — кандидати; інші (для іншого provider-а) мовчки ігноруються.
2. Кандидати групуються за `artifactId`. Якщо той самий `artifactId` заявлений ДВОМА РІЗНИМИ contributions (різний `(pluginName, id)`) — domain collision (spec §9.10): обидві виключаються з `relevant` і потрапляють у `collisions` з provenance обох сторін.
3. **`reportCiArtifactCollectionDiagnostics(reporter, collected)`** репортить `errors`/`collisions` через `createViolationReporter`-сумісний `reporter.fail(...)` — спільний текст/reason (`invalid-payload`, `artifact-id-collision`) для обох providers, щоб їхні `main.mjs` не дублювали цю логіку.

## Публічний API

`collectCiArtifactContributions` — збирає й фільтрує `ci.artifact@1` contributions для `targetCapability`, повертає `{ relevant, collisions, errors }`.
`reportCiArtifactCollectionDiagnostics` — репортить `errors`/`collisions` як violations через переданий reporter.

## Гарантії поведінки

* **Детермінований порядок**: `relevant` зберігає graph-порядок (`resolved plugin order → manifest order`) — критично для сценарію "два contributors в один target file", де порядок застосування T0-фіксу має бути стабільним.
* **Collision — symmetric**: якщо для `artifactId` виникає колізія, ЖОДНА зі сторін не потрапляє в `relevant` — немає silent override чи "перша виграє".
* **Не читає файлову систему поза графом**: сам граф і читання payload — єдині I/O; жоден provider-specific artifact (template, target file) тут не чіпається.
