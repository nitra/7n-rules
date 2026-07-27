---
type: JS Module
title: ci-artifact-consumer.mjs
resource: plugins/ci-github/slots/ci-artifact-consumer.mjs
docgen:
  crc: fae878c9
---

Generic consumer слоту `ci.artifact@1` для `@7n/rules-ci-github` (spec `2026-07-27-universal-plugin-slots-lang-php-extraction`, §7.2). Матеріалізує GitHub Actions workflow-артефакти будь-якого language-плагіна — без жодного PHP чи іншого мовного literal у цьому пакеті.

## Поведінка

`mergeStrategy: "deep-subset"` — рекурсивний structural merge: об'єкти мерджаться по ключах (природно покриває `jobs` — вже keyed object у GH workflow YAML); scalar-масиви (напр. `on.push.paths`) — ordered set-union без видалення consumer-specific записів; масиви обʼєктів (напр. `steps`) — identity-based: canonical-елемент шукається в actual-масиві за першим наявним полем `id` → `uses` → `name`, і лише його поля мерджаться — решта не чіпається.

1. **`loadCanonicalTemplate(contribution, descriptor)`** резолвить безпечний шлях `template` (`resolveArtifactTemplatePath`), читає й парсить його як YAML.
2. **`diagnoseArtifact({ cwd, targetPath, canonical })`** порівнює поточний стан `targetPath` з canonical-фрагментом (`diffDeepSubset`). Файл відсутній → `{ missing: true, violations: [] }` (mode-специфічна обробка — рішення викликача); файл є → список mismatch-повідомлень.
3. **`applyDeepSubsetFix({ cwd, targetPath, canonical, templateText, recordWrite })`** — T0-фікс: файл відсутній → копіюється `templateText` як є; файл існує → identity-aware deep-merge через YAML `Document` (зберігає коментарі/форматування наявного файлу). Idempotent: якщо diff порожній — жодного запису.

## Публічний API

`loadCanonicalTemplate` — читає й парсить canonical template одного artifact-у.
`diagnoseArtifact` — діагностує стан `targetPath` проти canonical-фрагмента.
`applyDeepSubsetFix` — застосовує T0-фікс (створення або identity-aware merge).
Default export — `loadSlotConsumer`-сумісний `{ id: 'ci-github-artifact', validate(payload) }`.

## Гарантії поведінки

* **Identity, не позиційний match**: елементи масивів обʼєктів ідентифікуються за `id`/`uses`/`name`, тому зайві consumer-specific поля на тому самому кроці не спричиняють дублювання при фіксі.
* **Ідемпотентність**: `applyDeepSubsetFix` спершу перевіряє diff і не пише файл, якщо канон уже задоволений.
* **Не володіє discovery**: не імпортує `plugin-slots.mjs` напряму — отримує `contribution`/`descriptor` вже перевіреними від викликача (generic rule).
