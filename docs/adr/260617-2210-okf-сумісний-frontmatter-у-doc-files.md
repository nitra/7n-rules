---
session: 17ad250b-bad4-4ae0-9d0b-bcd95c950ae4
captured: 2026-06-17T22:10:07+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/17ad250b-bad4-4ae0-9d0b-bcd95c950ae4.jsonl
---

Great, everything works! Let me run stamp one final time:
[assistant]
[tool: Bash] {"command":"node npm/rules/doc-files/js/docgen-files-batch.mjs stamp 2>&1 | tail -3","description":"Final stamp run to remove backward-compat fields"}
[user]
[tool_result] ✓ fix-doc-files --stamp: оновлено frontmatter у 240 доці(ах).
[assistant]
Готово. Зворотня сумісність прибрана — `RESOURCE_RE` тепер чистий без fallback на `source:`.

---

## ADR OKF-сумісний frontmatter у doc-files

## Context and Problem Statement
Проєкт `doc-files` генерував власний proprietarний YAML frontmatter (`docgen.source`, `docgen.crc` тощо), не сумісний з жодним відкритим стандартом. Користувач вирішив привести формат файлових доків у відповідність до [Open Knowledge Format (OKF)](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing) від Google — стандарту для передачі знань між людьми та AI-агентами — і додати автогенерацію `index.md` у кожній `docs/`-директорії.

## Considered Options
* Мінімальний OKF: лише `type` + `title` + `description` + `resource` на верхньому рівні, `docgen:` лише для CRC-механіки
* Повний OKF: всі поля (`resource`, `tags`, `timestamp` тощо)
* Без змін (власний формат)

## Decision Outcome
Chosen option: "Мінімальний OKF з `resource` на верхньому рівні", because OKF вимагає лише `type`; `title` і `description` потрібні для `index.md`; `resource` замінив `docgen.source`; `tags` і `timestamp` прибрані як малоцінні та такі, що спричиняють зайвий git-шум.

### Consequences
* Good, because файлові доки читаються OKF-сумісними інструментами та AI-агентами без додаткової конфігурації.
* Good, because `docgen:` namespace залишається для CRC-механіки — Marksman та інші LSP-сервери ігнорують невідомі YAML-поля, сумісність збережена.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінені файли: `npm/rules/doc-files/js/docgen-crc.mjs`, `npm/rules/doc-files/js/docgen-files-batch.mjs`
- `buildDocFrontmatter(source, crc, quality, model, body)` — генерує OKF frontmatter + `docgen:` блок
- `generateDirIndex(docsAbsDir, root)` — генерує `index.md` у кожній `docs/`-директорії, пропускає конфлікт з `index.ts/js`-доками
- `stamp` CLI-команда — оновлює frontmatter у 240 наявних доках
- Захист від конфліктів: якщо `index.md` є докою для source-файлу (`type ≠ Directory Index`), директорійний `index.md` не генерується

---

## ADR index.md — Directory Index у кожній docs/-директорії

## Context and Problem Statement
Після переходу на OKF виникла потреба у навігаційному файлі для кожної директорії з документацією — аналог `index.md` в OKF-специфікації, який дає огляд усіх концептів у поточній директорії.

## Considered Options
* Автогенерація `index.md` після кожного gen/stamp батчу
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Автогенерація `index.md` після кожного gen/stamp батчу", because це стандартна OKF-конвенція, яку реалізувати можна адитивно в кінці `runGenerationBatch` та `runDocFilesStampCli`.

### Consequences
* Good, because кожна `docs/`-директорія отримує таблицю всіх концептів із `type` і першим реченням опису — без ручного супроводу.
* Bad, because конфлікт назви з `docs/index.md` (дока для `index.ts`) — вирішено пропуском генерації для директорій, де `index.md` вже є source-file-докою (`type ≠ Directory Index`).

## More Information
- `generateDirIndex` читає наявні `.md`-файли в директорії, витягує OKF-поля через regex, будує markdown-таблицю
- Frontmatter Directory Index: `type: Directory Index`, `title: <відносний шлях>`, `resource: <шлях>/`
- Конфліктуючі директорії виявлені скриптом: 103 `docs/`-директорії мали `index.md` (дока для `index.ts`) + інші файли; захист реалізований через перевірку `existingType !== 'Directory Index'`
