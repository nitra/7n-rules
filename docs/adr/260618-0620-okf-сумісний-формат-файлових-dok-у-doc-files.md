---
session: 17ad250b-bad4-4ae0-9d0b-bcd95c950ae4
captured: 2026-06-18T06:20:42+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/17ad250b-bad4-4ae0-9d0b-bcd95c950ae4.jsonl
---

відповідь готова. Усі зміни застосовані:
1. OKF-мінімум: `type`, `title`, `description`, `resource` + `docgen.crc`
2. `docgen.source` → `resource` (top-level)
3. H1 більше не дублює `title` у тілі документа
4. `index.md` генерується в кожній `docs/`-директорії

---

## ADR OKF-сумісний формат файлових dok у doc-files

## Context and Problem Statement
Існуючий генератор документації doc-files зберігав метадані виключно у власному `docgen:`-просторі імен (поля `source`, `crc`, `score`, `model`). Такий формат не є переносним і не зрозумілий AI-агентам поза проєктом. Команда вирішила привести файлові доки до відповідності з відкритим стандартом **Open Knowledge Format (OKF)** від Google.

## Considered Options
* Адаптувати наявний формат: додати OKF-поля поряд із `docgen:`-блоком.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Адаптувати наявний формат", because користувач прямо визначив цей підхід: OKF-поля (`type`, `title`, `description`, `resource`) додаються на верхній рівень YAML frontmatter, а `docgen:`-блок зберігає лише CRC-механіку (`crc`, `score`, `model`).

Фінальна структура frontmatter:
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

Додаткові уточнення в ході сесії:
- `resource`, `tags`, `timestamp` спочатку були включені, але потім прибрані як надлишкові (`resource` — дублює `docgen.source`; `tags` — мало цінності; `timestamp` — зайвий git-шум). Залишені лише `type`, `title`, `description`.
- Потім `resource` повернули на верхній рівень замість `docgen.source` (`docgen.source` видалений як дублювання).
- Зворотна сумісність зі старим `docgen.source` спочатку була реалізована через `LEGACY_SOURCE_RE`, але потім видалена як непотрібна.
- H1-заголовок у тілі документа видаляється у `stampDoc`, оскільки `title:` вже присутній у frontmatter.

### Consequences
* Good, because transcript фіксує очікувану користь: файлові доки стають переносними й читабельними будь-яким AI-агентом чи інструментом, що розуміє OKF; Marksman-сумісність збережена (YAML frontmatter розширюється адитивно).
* Good, because автоматична генерація `index.md` у кожній `docs/`-директорії дає Directory Index — зведену таблицю всіх концептів теки.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінені файли: `npm/rules/doc-files/js/docgen-crc.mjs`, `npm/rules/doc-files/js/docgen-files-batch.mjs`
- Нові хелпери в `docgen-crc.mjs`: `typeForSource(source)`, `extractDescription(body)`
- Нова функція в `docgen-files-batch.mjs`: `generateDirIndex(docsAbsDir, root)` — генерує `index.md` типу `Directory Index`; пропускає директорію якщо `index.md` вже є дока для `index.ts/js` (перевірка за `resource:` ≠ `'Directory Index'` типом).
- Stamp-команда: `node npm/rules/doc-files/js/docgen-files-batch.mjs stamp` — оновила frontmatter у 240 існуючих доках.
- Change-файл: `.changes/260617-2050.md`.
- Посилання на специфікацію: `https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing`
