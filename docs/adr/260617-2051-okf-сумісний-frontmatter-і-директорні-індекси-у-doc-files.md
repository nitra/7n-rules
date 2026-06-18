---
session: 17ad250b-bad4-4ae0-9d0b-bcd95c950ae4
captured: 2026-06-17T20:51:50+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/17ad250b-bad4-4ae0-9d0b-bcd95c950ae4.jsonl
---

Зміни зафіксовані.
[assistant]
Все готово. Ось що було зроблено:

**Зміни в `docgen-crc.mjs`:**
- Новий import: `basename`, `extname` з `node:path`
- `typeForExtension(ext)` → маппінг розширення на OKF `type` (`JS Module`, `TS Module`, `Vue Component`, `Python Module`, `Source File`)
- `tagsForSource(source)` → теги з розширення файлу
- `extractDescription(body)` → перше речення з секції `## Огляд`
- `buildDocFrontmatter(source, crc, quality, model, body)` — тепер генерує OKF-поля перед блоком `docgen:`
- `stampDoc` — передає тіло в `buildDocFrontmatter` для авто-екстракції `description`

**Зміни в `docgen-files-batch.mjs`:**
- Нові imports: `readdirSync`, `basename`, `relative`
- `generateDirIndex(docsAbsDir, root)` — генерує `index.md` із OKF frontmatter і таблицею всіх наявних doc-файлів; пропускає якщо в директорії тільки `index.md`, і не перезаписує source-file-docs
- `runGenerationBatch` і `runDocFilesStampCli` — після основної роботи оновлюють `index.md` у кожній `docs/`-директорії

**240 файлів** отримали новий OKF-frontmatter, **124 `index.md`** згенеровано. Сумісність з Marksman збережена.

---

## ADR OKF-сумісний frontmatter і директорні індекси у doc-files

## Context and Problem Statement
Механізм генерації файлових doc-docs зберігав лише технічні поля `docgen.source` і `docgen.crc` у frontmatter, без стандартизованих метаданих. Проєкт поставив за мету зробити ці файли сумісними зі специфікацією Open Knowledge Format (OKF), яка вимагає `type`, `title`, `description`, `resource`, `tags`, `timestamp`, а також передбачає файл `index.md` у кожній директорії знань.

## Considered Options
* Адитивне розширення frontmatter: додати OKF-поля поверх існуючого `docgen:` неймспейсу
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Адитивне розширення frontmatter", because це адитивна зміна — `docgen:` блок залишається незмінним, а нові OKF-поля (`type`, `title`, `description`, `resource`, `tags`, `timestamp`) додаються перед ним у тому ж YAML.

### Consequences
* Good, because сумісність з Marksman LSP збережена: він ігнорує невідомі поля і лише читає `title`; зміна не ламає існуючу CRC-логіку в `docgen:` блоці.
* Good, because transcript фіксує очікувану користь: 240 файлів отримали OKF-frontmatter і 124 `index.md` файли директорних індексів згенеровано після одного запуску `stamp`.
* Bad, because виник конфлікт імен `index.md` — source-file-docs для `index.ts`/`index.mjs` і директорний `index.md` мають однакову назву; вирішено захистом в `generateDirIndex` (перевірка наявного `type` у frontmatter).

## More Information
- Змінені файли: `npm/rules/doc-files/js/docgen-crc.mjs`, `npm/rules/doc-files/js/docgen-files-batch.mjs`
- Нові функції: `typeForExtension`, `tagsForSource`, `extractDescription` (в `docgen-crc.mjs`); `generateDirIndex` (в `docgen-files-batch.mjs`)
- Change-файл: `.changes/260617-2050.md`
- OKF специфікація: https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing

---

ADR зафіксований.
