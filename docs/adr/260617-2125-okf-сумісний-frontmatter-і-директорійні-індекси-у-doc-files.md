---
type: ADR
title: OKF-сумісний frontmatter і директорійні індекси у doc-files
description: `doc-files` генерує OKF-сумісний frontmatter для файлових доків і підтримує `index.md` як Directory Index у `docs/`-директоріях.
---

**Status:** Accepted
**Date:** 2026-06-17

## Context and Problem Statement

Механізм генерації файлової документації `doc-files` створював markdown-файли з внутрішнім `docgen:`-блоком у frontmatter, де зберігалися `source`, `crc`, `model` і `score`. Ці файли не мали OKF-сумісних top-level метаданих для AI-агентів. Також не було автоматичної навігаційної точки входу `index.md` для кожної `docs/`-директорії.

## Considered Options

- Адитивне розширення frontmatter: OKF-поля top-level і збережений `docgen:` namespace.
- Повне перезаписання на чистий OKF без `docgen:`.
- Автогенерація `index.md` після кожного `gen`/`stamp` batch.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Адитивне розширення frontmatter з OKF-полями і автогенерацією Directory Index", because цей варіант зберігає CRC-механіку в `docgen:` namespace, додає стандартні OKF-поля для AI-агентів і природно вбудовує генерацію `index.md` у наявний `gen`/`stamp` конвеєр.

### Consequences

- Good, because `type`, `title`, `description` і `resource` є top-level OKF-полями, які AI-агенти можуть читати без адаптерів.
- Good, because `docgen:` namespace зберігає CRC-механіку та інкрементну перевірку застарілості документації.
- Good, because Marksman LSP сумісний: transcript фіксує, що він ігнорує невідомі frontmatter-поля і використовує `title` як назву документа.
- Good, because `generateDirIndex` створює навігаційний `index.md` з таблицею документів у кожній обробленій `docs/`-директорії.
- Bad, because `index.md` конфліктує з документацією для source-файлів `index.ts` або `index.mjs`; реалізовано захист, але такі директорії можуть не отримати Directory Index.
- Bad, because transcript фіксує непослідовність навколо `timestamp` і `tags`: для source-file docs їх прибрали як шум, а в Directory Index вони згадувалися в прикладі.

## More Information

- Змінені файли: `npm/rules/doc-files/js/docgen-crc.mjs`, `npm/rules/doc-files/js/docgen-files-batch.mjs`.
- Функції й хелпери: `buildDocFrontmatter`, `parseDocFrontmatter`, `typeForSource` або `typeForExtension`, `extractDescription`, `generateDirIndex`.
- `SOURCE_RE` замінено або еволюціоновано до `RESOURCE_RE`; у batch-логіці згадано `OKF_RESOURCE_RE`.
- `resource` використовується як top-level OKF-поле для шляху source-файлу; transcript також фіксує fallback-сумісність зі старим `docgen.source`.
- `description` витягується з першого речення секції `## Огляд`.
- `generateDirIndex` читає OKF-поля через `OKF_TITLE_RE`, `OKF_TYPE_RE`, `OKF_DESC_RE`, `OKF_FRONTMATTER_RE`, `OKF_RESOURCE_RE` і формує таблицю `| Файл | Тип | Опис |`.
- Команда міграції й перевірки з transcript: `node npm/rules/doc-files/js/docgen-files-batch.mjs stamp`.
- Change-файл: `.changes/260617-2050.md`.

## Update 2026-06-17

- Початковий намір полягав у переведенні файлів, які генерує `/n-docgen` / skill `doc-files`, на OKF-сумісний Markdown з YAML frontmatter і standard markdown links.
- У transcript як відкритий ризик зафіксовано питання сумісності standard `[text](path.md)` посилань OKF із Marksman wiki-link навігацією `[[link]]`; подальше рішення зберегло Marksman-сумісність.
- На момент початкового аналізу без OKF frontmatter згадувалися `docs/app.md`, `docs/eslint.config.md`, `docs/fix-cursor-skill.md`, `docs/coverage-fix-skill.md`, `docs/doc-files-skill.md`.

## Update 2026-06-17

- Перший зафіксований прогін додав OKF frontmatter до 240 файлів і згенерував 124 директорійні `index.md`.
- Реалізація додала `typeForExtension`, `tagsForSource`, `extractDescription`, `buildDocFrontmatter` і оновила `stampDoc`, щоб передавати тіло документа для автоекстракції `description`.
- Для директорійних індексів було додано `generateDirIndex(docsAbsDir, root)`, який пропускає директорії, де `index.md` уже є документацією source-файлу.

## Update 2026-06-17

- Після уточнення мінімального OKF-набору для source-file docs залишено `type`, `title` і `description`, а `resource`, `tags` і `timestamp` на цьому етапі описувалися як прибрані через надлишковість або git-шум.
- `EXT_TYPES` у `docgen-crc.mjs` мапить `.js`/`.mjs`/`.cjs` у `JS Module`, `.ts` у `TS Module`, `.vue` у `Vue Component`, `.py` у `Python Module`.
- `generateDirIndex` викликається після `runGenerationBatch` і `runDocFilesStampCli`, оновлюючи індекси в унікальних `docs/`-директоріях з обробленими файлами.

## Update 2026-06-17

- `doc-files` остаточно перейшов на OKF-сумісний frontmatter для файлових документів: top-level `type`, `title`, `description`, `resource`, а `docgen:` лишився для CRC-механіки.
- `docgen.source` замінено на top-level `resource`; зворотну сумісність зі старим `source:` прибрано після фінального `stamp`.
- `stamp` оновив frontmatter у 240 документах.
- `generateDirIndex(docsAbsDir, root)` генерує `index.md` у кожній `docs/`-директорії та пропускає директорію, якщо наявний `index.md` є документацією source-файлу, а не `Directory Index`.
- Transcript фіксує, що негативні наслідки для цього рішення не підтверджені.

## Update 2026-06-18

- Уточнено фінальний формат файлової документації: OKF-поля винесені на верхній рівень YAML frontmatter, а `docgen:` зберігає лише технічні поля CRC/score/model.
- `resource` повернули як єдине top-level поле шляху джерела замість `docgen.source`; тимчасовий `LEGACY_SOURCE_RE` для старого `docgen.source` після міграції видалено.
- H1 у тілі документа видаляється під час `stampDoc`, бо `title:` уже є у frontmatter.
- `node npm/rules/doc-files/js/docgen-files-batch.mjs stamp` оновив 240 наявних документів.
- Згадані файли реалізації: `npm/rules/doc-files/js/docgen-crc.mjs`, `npm/rules/doc-files/js/docgen-files-batch.mjs`; change-файл `.changes/260617-2050.md`.

## Update 2026-06-18

- Зафіксовано деталізацію OKF-міграції `doc-files`: початково розглядали адитивне додавання `type`, `title`, `description`, `resource`, `tags`, `timestamp` поруч із `docgen:`.
- Потім формат скорочено: `tags` і `timestamp` прибрано через низьку цінність і git-шум; `resource` перенесено на верхній рівень як заміну `docgen.source`.
- Після окремого уточнення `description` також прибрано з frontmatter, бо опис уже є в тілі документа; з `index.md` прибрано колонку опису.
- `generateDirIndex` захищає source-file документацію: якщо наявний `docs/index.md` має `type`, відмінний від `Directory Index`, директорійний індекс не перезаписує цей файл.
- `stampDoc` прибирає H1 з тіла через `/^# .+\n+/`, бо `title` уже міститься у frontmatter.
- Команда міграції/перевірки: `node npm/rules/doc-files/js/docgen-files-batch.mjs stamp`; transcript фіксує оновлення 240 файлів.
