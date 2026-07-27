---
type: JS Module
title: slot-contracts-ci.mjs
resource: npm/scripts/lib/slot-contracts-ci.mjs
docgen:
  crc: be6fce7a
---

Canonical payload-контракт слоту `ci.artifact@1` (spec `2026-07-27-universal-plugin-slots-lang-php-extraction`, §7.1). Broker (`plugin-slots.mjs`) валідує лише universal envelope contribution-а (`slot`/`version`/`id`/`resource`|`value`/`requires`) — сам payload (JSON-документ contribution-у) типізує й перевіряє цей модуль, спільний для `@7n/rules-ci-github` і `@7n/rules-ci-azure`. Публічний доступ — `@7n/rules/plugin-api` (re-export).

## Поведінка

1. **`validateCiArtifactPayload(raw)`** перевіряє форму payload-у: `targetCapability` (непорожній рядок), `artifactId` (regex `^[a-z][a-z0-9-]*$`), `targetPath` (безпечний repo-relative шлях), `format` (у v1 лише `"yaml"`), `mode` (`required-file`|`patch-existing`), `template` (безпечний шлях від каталогу дескриптора, починається з `./`), `mergeStrategy` (`deep-subset`|`contains-step`), `fix` (boolean). Невідомі поля payload відхиляються — нове поле, яке змінює semantics, потребує `ci.artifact@2`. Усі помилки акумулюються в одному виклику; валідний payload повертається як заморожений `descriptor`.
2. **`resolveArtifactTemplatePath(contribution, descriptor)`** резолвить абсолютний шлях `descriptor.template` — від каталогу дескриптора (`dirname(contribution.resourcePath)` для resource-based contributions; `contribution.packageRoot` для value-based, де "каталогу дескриптора" не існує) — з containment-перевіркою в межах `contribution.packageRoot` (та сама межа безпеки, що broker застосовує до всіх package-relative шляхів). Не читає вміст файлу — лише перевіряє безпечність шляху й факт існування (`exists`).
3. **`loadCiArtifactPayload(contribution)`** читає й розбирає payload contribution-у (`resource` XOR `value`, вже резолвлені broker-ом у `SlotContribution`). Broker ніколи не читає вміст `resource` — це єдине місце, де вміст дескриптора реально завантажується з диска, і робить це сам consumer, а не broker.

## Публічний API

`CI_ARTIFACT_ID_RE` — regex `artifactId` (той самий формат, що й `id` contribution-у в universal envelope).
`isSafeRepoRelativePath` — перевіряє безпечний repo-relative шлях (`targetPath`): без абсолютних і `..`-сегментів.
`isSafeTemplateRelPath` — перевіряє безпечний package-relative шлях у стилі envelope (`template`): починається з `./`, без `..`-сегментів.
`validateCiArtifactPayload` — валідує payload `ci.artifact@1`, повертає `{ ok: true, descriptor }` або `{ ok: false, errors }`.
`resolveArtifactTemplatePath` — резолвить і перевіряє containment абсолютного шляху `template`.
`loadCiArtifactPayload` — читає й парсить `resource`/`value` contribution-у в сирий (ще не валідований) payload.

## Гарантії поведінки

* **Не читає слот-граф**: модуль не імпортує `plugin-slots.mjs` — це навмисно розриває потенційний import-цикл із `plugin-api.mjs` (яке re-експортує звідси); collect-логіка, що потребує графа, живе в окремому `ci-artifact-collect.mjs`.
* **Сувора валідація**: невідомі поля payload завжди відхиляються (v1), без graceful degradation.
* **Безпечність шляхів**: `template` перевіряється і за формою (`isSafeTemplateRelPath`), і за containment (`resolveArtifactTemplatePath`) — вихід за межі `packageRoot` заблокований незалежно від того, чи файл існує.
