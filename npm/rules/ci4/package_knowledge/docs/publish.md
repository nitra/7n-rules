---
type: JS Module
title: publish.mjs
resource: npm/rules/ci4/package_knowledge/publish.mjs
docgen:
  crc: c598e812
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`publishKnowledgeArtifacts` публікує knowledge artifacts у `docs/` як публічний крок оновлення документації пакета. Це потрібно, щоб зміни в knowledge artifacts потрапляли в корінь пакета послідовно й у придатному для публікації вигляді.

## Поведінка

1. `publishKnowledgeArtifacts` спочатку відсіює некоректний запит: джерело публікації має бути абсолютним шляхом, набір кандидатів — об’єктом, і серед них обов’язково має бути `docs/.docgen/manifest.json`.
2. Далі вона приймає тільки документи в межах `docs/` і тільки текстові значення; усе інше зупиняє публікацію з діагностикою.
3. Після цього `publishKnowledgeArtifacts` вимагає зовнішню перевірку від викликача й не продовжує роботу, якщо та не підтвердила готовність змін.
4. Для кожного Markdown-документа вона порівнює новий вміст із поточним станом і не дозволяє змінювати захищені ділянки вже опублікованих файлів; для нових файлів перевіряє, що вміст придатний до публікації.
5. Якщо попередні перевірки пройдено, `publishKnowledgeArtifacts` готує тимчасову staging-область, копіює туди чинні docs, накладає кандидатні зміни та лише після цього переходить до заміни.
6. Публікація завершується атомарною підміною docs у корені пакета: або оновлюється весь набір артефактів разом, або при збої відновлюється попередній стан.
7. У разі будь-якої помилки `publishKnowledgeArtifacts` повертає відмову з діагностикою, не залишаючи частково опублікований стан.

## Публічний API

- publishKnowledgeArtifacts — Atomically publishes caller-validated docs candidates. All writes first land in a same-volume
staging directory; a failed validator, zone check or staging operation leaves committed docs
and manifest bytes untouched.

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/publish.test.mjs` (atomic package knowledge publication) — caller validation failure leaves docs and manifest byte-identical; publishes through stage only after validation and preserves protected zones; protected-zone conflict aborts before replacing committed docs

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
