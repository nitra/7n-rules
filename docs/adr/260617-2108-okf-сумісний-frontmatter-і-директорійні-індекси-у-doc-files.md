---
session: 17ad250b-bad4-4ae0-9d0b-bcd95c950ae4
captured: 2026-06-17T21:08:31+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/17ad250b-bad4-4ae0-9d0b-bcd95c950ae4.jsonl
---

---

## ADR OKF-сумісний frontmatter і директорійні індекси у doc-files

## Context and Problem Statement
Механізм генерації файлової документації (`doc-files`) виробляв markdown-файли з суто внутрішнім `docgen:`-блоком у frontmatter. Ці файли не відповідали стандарту Open Knowledge Format (OKF), що унеможливлює уніфіковане читання AI-агентами та інтеграцію з OKF-сумісними інструментами. Також була відсутня автоматична навігаційна точка входу (`index.md`) для кожної `docs/`-директорії.

## Considered Options
* Адитивне розширення frontmatter OKF-полями (повний набір: `type`, `title`, `description`, `resource`, `tags`, `timestamp`) з виключенням поля `timestamp` і `resource`/`tags` після обговорення мінімального обов'язкового набору
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Мінімальний OKF frontmatter (`type`, `title`, `description`) + автогенерований `index.md`", because OKF вимагає лише поле `type`; `title` потрібен для таблиці індексу; `description` — найцінніша частина для AI-агентів. Поля `resource`, `tags`, `timestamp` прибрані як надлишкові або такі, що генерують зайвий git-шум.

### Consequences
* Good, because `docgen:`-namespace з CRC залишається без змін — існуюча логіка перевірки актуальності (`crc32` порівняння) і Marksman LSP-сумісність не порушені.
* Good, because `stampDoc` автоматично екстрагує `description` з першого речення секції `## Огляд` у тілі документа, тому міграція існуючих 240 доків відбулася одним `stamp`-прогоном.
* Good, because `generateDirIndex` пропускає директорії де `index.md` вже є дока для source-файлу (`index.ts`/`index.mjs`), уникаючи перезапису.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінені файли: `npm/rules/doc-files/js/docgen-crc.mjs`, `npm/rules/doc-files/js/docgen-files-batch.mjs`
- Нові хелпери: `typeForSource(source)` (визначає OKF `type` за розширенням), `extractDescription(body)` (витягує перше речення з `## Огляд`), `generateDirIndex(docsAbsDir, root)` (генерує/оновлює `index.md`)
- `buildDocFrontmatter(source, crc, quality, model, body)` — додано параметр `body` для екстракції `description`
- `stampDoc` передає `cleanBody` у `buildDocFrontmatter` при оновленні frontmatter
- Константа `EXT_TYPES` у `docgen-crc.mjs` містить маппінг розширень → OKF type: `.js`/`.mjs`/`.cjs` → `'JS Module'`, `.ts` → `'TS Module'`, `.vue` → `'Vue Component'`, `.py` → `'Python Module'`
- Генерація `index.md` викликається після `runGenerationBatch` і `runDocFilesStampCli` — оновлює індекси в усіх унікальних `docs/`-директоріях з обробленими файлами
- Change-файл створено: `.changes/260617-2050.md`
