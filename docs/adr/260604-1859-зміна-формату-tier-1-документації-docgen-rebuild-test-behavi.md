---
session: d943f92b-e895-4110-8ae0-338380a03c95
captured: 2026-06-04T18:59:24+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/d943f92b-e895-4110-8ae0-338380a03c95.jsonl
---

Промпт оновлено в обох файлах. Ключові зміни:
- «Rebuild Test» → «Behavior Test» як цільовий критерій
- Нові секції: `## Поведінка` (покроковий алгоритм) замість `## Функції` + `## Залежності`
- Явна заборона перелічувати `node:fs`, `node:path` та інші stdlib-модулі
- Заборона на внутрішні назви функцій/змінних — тільки публічні exports

---

## ADR Зміна формату Tier 1 документації docgen: «Rebuild Test» → «Behavior Test»

## Context and Problem Statement
Скіл `n-docgen` генерував файлові доки з секціями `## Залежності` та `## Функції`, що перелічували модулі стандартної бібліотеки (node:fs, node:path тощо) та внутрішні ідентифікатори функцій. Аналіз прикладу `npm/rules/abie/lib/docs/enabled.md` показав: такі деталі не несуть бізнес-цінності й захаращують документ.

## Considered Options
* «Behavior Test» — фокус на поведінці (ЩО і НАВІЩО), секції `## Поведінка`, `## Публічний API`, `## Де використовується`, `## Помилки`; stdlib і внутрішні ідентифікатори прибрані.
* «Rebuild Test» — вичерпна документація із секціями `## Залежності` та `## Функції`, що дозволяла відтворити реалізацію (попередній підхід).

## Decision Outcome
Chosen option: «Behavior Test», because аналіз `npm/rules/abie/lib/docs/enabled.md` показав, що перелік `node:fs`/`node:path` та внутрішніх назв (`isAbieRuleEnabled`) не додає цінності читачеві й захаращує документ.

### Consequences
* Good, because transcript фіксує очікувану користь: документ коротший і зосереджений на ролі файлу в системі — читач розуміє бізнес-задачу без читання реалізації.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінено промпт Tier 1 субагента у файлах `npm/skills/docgen/SKILL.md` і `.cursor/skills/n-docgen/SKILL.md` (блок «Крок 3: Диспатч субагентів батчами по 5»). Додано правила: НЕ перелічувати stdlib-модулі (node:fs, node:path, node:crypto, python stdlib), НЕ перелічувати внутрішні ідентифікатори — лише публічні exports. Приклад-еталон формату — `npm/rules/abie/lib/docs/enabled.md` (створений вручну під час сесії).
