---
type: ADR
title: OKF frontmatter і Directory Index для doc-files
description: Згенеровані doc-files отримують OKF frontmatter, а docs-директорії — автогенерований Directory Index.
---

**Status:** Accepted
**Date:** 2026-06-17

## Context and Problem Statement

Проєкт має механізм генерації документаційних `.md` файлів `doc-files`, де кожна дока містила лише внутрішній `docgen:` блок із полями на кшталт `source`, `crc`, `model`, `score`. Потрібно привести формат до сумісності з Open Knowledge Format, зберегти Marksman LSP-сумісність і не зламати наявну CRC-механіку.

Після адаптації frontmatter також виникла потреба в навігаційному поданні кожної `docs/` теки у форматі, який AI-агенти можуть використовувати як граф документації.

## Considered Options

- Адитивне розширення frontmatter: OKF-поля top-level і збережений `docgen:` namespace.
- Повне перезаписання на чистий OKF без `docgen:`.
- Автогенерація `index.md` після кожного `gen` або `stamp` батчу.
- Інші варіанти для Directory Index у transcript не обговорювалися.

## Decision Outcome

Chosen option: "Адитивне OKF-розширення frontmatter і автогенерація `index.md`", because top-level OKF-поля читаються AI-агентами без адаптерів, а `docgen:` namespace зберігає CRC-механіку; `generateDirIndex` природно вбудовується після `runGenerationBatch` і `runDocFilesStampCli`.

Фінальний мінімальний формат source-file doc:

```yaml
---
type: TS Module
title: index.ts
description: "Файл збирає записи сесії..."
resource: npm/.pi-template/extensions/n-cursor-adr/index.ts
docgen:
  crc: 3233716f
  score: 100
---
```

Формат `index.md`:

```yaml
---
type: Directory Index
title: npm/scripts/lib
description: "Documentation index for npm/scripts/lib"
resource: npm/scripts/lib/
tags: [index]
---
```

## Consequences

- Good, because `type`, `title`, `description`, `resource` є OKF-полями, які можуть читати AI-агенти.
- Good, because Marksman LSP лишається сумісним: він ігнорує невідомі frontmatter-поля і може використовувати `title`.
- Good, because `docgen:` namespace зберігає CRC-механіку й інкрементну перевірку актуальності доків.
- Good, because AI-агенти і Marksman отримують навігаційний граф через стандартні `[text](path.md)` посилання у таблиці Directory Index.
- Bad, because `index.md` як імʼя конфліктує з документацією для source-файлів `index.ts` або `index.mjs`; реалізовано захист, але такі теки не отримують директорійного індексу.
- Bad, because `timestamp` прибрано з source-file docs, тому час генерації більше не записується у файл і лишається тільки в git history.
- Bad, because `tags: [index]` у Directory Index лишилися, на відміну від source-file docs; transcript позначає це як незначну неузгодженість, не обговорену окремо.

## More Information

Змінені файли:

- `npm/rules/doc-files/js/docgen-crc.mjs`: `buildDocFrontmatter`, `parseDocFrontmatter`, заміна `SOURCE_RE` на `RESOURCE_RE`, видалення `tagsForSource`.
- `npm/rules/doc-files/js/docgen-files-batch.mjs`: заміна `DOCGEN_SOURCE_RE` на `OKF_RESOURCE_RE`, нова функція `generateDirIndex`, виклики після `runGenerationBatch` і `runDocFilesStampCli`.

Команда перевірки та міграції з transcript:

```sh
node npm/rules/doc-files/js/docgen-files-batch.mjs stamp
```

Захист від конфліктів `index.md`: `generateDirIndex` перевіряє `type` існуючого файлу; якщо це не `Directory Index`, генерація для цієї теки пропускається.

Регекси для читання OKF-полів існуючих доків: `OKF_TITLE_RE`, `OKF_TYPE_RE`, `OKF_DESC_RE`, `OKF_FRONTMATTER_RE`, `OKF_RESOURCE_RE`. Зворотна сумісність зі старим `docgen.source`: `OKF_RESOURCE_RE` спочатку шукає top-level `resource:`, потім старий `source:` з відступом.

## Update 2026-06-17

Раніша чернетка того самого рішення фіксувала, що після одного запуску `stamp` 240 файлів отримали OKF-frontmatter, а 124 `index.md` файли директорних індексів було згенеровано.

Також зафіксовано проміжні helper-и `typeForExtension`, `tagsForSource`, `extractDescription`, `buildDocFrontmatter` і `generateDirIndex`; фінальна чернетка уточнює їхній актуальний мінімальний формат.

## Update 2026-06-17

Уточнено проміжне рішення: мінімальний OKF frontmatter для doc-files складався з `type`, `title`, `description`, а `timestamp`, `resource` і `tags` були відкинуті як надлишкові або такі, що створюють зайвий git-шум. Пізніша чернетка цього ж батчу уточнила, що `resource` все ж лишається top-level OKF-полем замість `docgen.source`.

Додаткові факти: `generateDirIndex` викликається після `runGenerationBatch` і `runDocFilesStampCli`, а директорії з наявним `index.md` для source-файлу `index.ts` або `index.mjs` пропускаються, щоб не перезаписати source-file документацію.
