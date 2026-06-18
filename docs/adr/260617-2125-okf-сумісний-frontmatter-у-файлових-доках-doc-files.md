---
session: 17ad250b-bad4-4ae0-9d0b-bcd95c950ae4
captured: 2026-06-17T21:25:49+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/17ad250b-bad4-4ae0-9d0b-bcd95c950ae4.jsonl
---

## ADR OKF-сумісний frontmatter у файлових доках doc-files

## Context and Problem Statement
Проєкт має механізм генерації документаційних `.md`-файлів (`doc-files`), де кожна дока несла лише власний `docgen:`-блок із полями `source`, `crc`, `model`, `score`. Необхідно привести формат до сумісності з Open Knowledge Format (OKF) — відкритою специфікацією Google для метаданих, якими можуть оперувати AI-агенти, — зберігши при цьому сумісність з Marksman LSP і наявну CRC-механіку.

## Considered Options
* Адитивне розширення frontmatter: OKF-поля (top-level) + збережений `docgen:`-namespace
* Повне перезаписання на чистий OKF (без `docgen:`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Адитивне розширення frontmatter з подальшим злиттям `resource` у top-level", because перший варіант зберігав зворотну сумісність через `docgen.crc`, але у ході сесії `docgen.source` замінено на top-level OKF-поле `resource` (за явним запитом користувача), щоб уникнути дублювання і дотриматись OKF-семантики. Поля `tags` і `timestamp` прибрано як такі, що спричиняли git-шум та мали низьку цінність; `resource` — єдиний шлях, що залишається в обох namespace.

Фінальний мінімальний формат:
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

### Consequences
* Good, because `type`, `title`, `description`, `resource` — стандартні OKF-поля, що читаються AI-агентами без адаптерів.
* Good, because Marksman LSP сумісний: ігнорує невідомі frontmatter-поля, `title` у frontmatter використовується як назва документа в LSP-підказках.
* Good, because `docgen:`-namespace зберігає CRC-механіку — інкрементна перевірка застарілості доків лишилась без змін.
* Bad, because `timestamp` прибрано — час генерації доки більше не записується в файл (лише в git-historyx).
* Bad, because Існуючі доки для `index.ts`/`index.mjs` конфліктують із директорійним `index.md` у тій самій `docs/`-теці: `generateDirIndex` пропускає теки, де вже є дока для source-файлу з іменем `index.*`.

## More Information
Змінені файли:
- `npm/rules/doc-files/js/docgen-crc.mjs` — `buildDocFrontmatter`, `parseDocFrontmatter`, `SOURCE_RE` → `RESOURCE_RE`, видалено `tagsForSource`
- `npm/rules/doc-files/js/docgen-files-batch.mjs` — `DOCGEN_SOURCE_RE` → `OKF_RESOURCE_RE`, нова функція `generateDirIndex`, виклики після `runGenerationBatch` і `runDocFilesStampCli`

Команди перевірки та міграції:
```
node npm/rules/doc-files/js/docgen-files-batch.mjs stamp
```

Захист від конфліктів `index.md`: `generateDirIndex` перевіряє `type` існуючого файлу — якщо не `Directory Index`, пропускає генерацію для тієї теки.

---

## ADR Генерація `index.md` — OKF Directory Index у кожній `docs/`-директорії

## Context and Problem Statement
Після адаптації frontmatter під OKF виникла потреба в агрегованому поданні кожної `docs/`-теки у форматі, який AI-агенти можуть використовувати як навігаційний граф. OKF-специфікація передбачає `index.md` у кожній директорії як "Directory Index".

## Considered Options
* Автогенерація `index.md` після кожного `gen`/`stamp`-батчу
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Автогенерація `index.md` після кожного `gen`/`stamp`-батчу", because це природно вписується в наявний конвеєр: `generateDirIndex` викликається після `runGenerationBatch` і `runDocFilesStampCli`, збирає всі унікальні `docs/`-директорії зі списку оброблених targets і генерує або оновлює `index.md` у кожній із них.

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
з markdown-таблицею `| Файл | Тип | Опис |` для кожного `.md`-файлу в директорії (крім `index.md`).

### Consequences
* Good, because transcript фіксує очікувану користь: AI-агенти і Marksman отримують навігаційний граф через стандартні `[text](path.md)` посилання у таблиці.
* Bad, because `index.md` як ім'я конфліктує з документом для source-файлів `index.ts`/`index.mjs`; реалізовано захист, але теки з таким конфліктом не отримують директорійного індексу.
* Bad, because `timestamp` і `tags: [index]` у Directory Index залишились (на відміну від source-file docs де їх прибрали) — незначна непослідовність, не обговорена в transcript.

## More Information
Функція `generateDirIndex` у `npm/rules/doc-files/js/docgen-files-batch.mjs`.

Регекс для читання OKF-полів існуючих доків: `OKF_TITLE_RE`, `OKF_TYPE_RE`, `OKF_DESC_RE`, `OKF_FRONTMATTER_RE`, `OKF_RESOURCE_RE`.

Зворотна сумісність зі старим `docgen.source`: `OKF_RESOURCE_RE` спочатку шукає top-level `resource:`, потім з відступом `source:` (старий формат).
