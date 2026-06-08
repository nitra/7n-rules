---
session: 8b11db51-73d3-415e-b4a5-229e69334733
captured: 2026-06-07T21:07:29+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/8b11db51-73d3-415e-b4a5-229e69334733.jsonl
---

n-cursor sync
```
[assistant]
Готово. `n-flow.mdc` прибрано назавжди:

- `"flow"` видалено з `rules` та додано в `disable-rules` у `.n-cursor.json`
- Sync підтвердив: `− .cursor/rules/n-flow.mdc` видалено як "поза списком"
- При кожному наступному `npx @nitra/cursor` правило більше не матеріалізується

---

## ADR Вимкнення правила `n-flow.mdc` через `disable-rules`

## Context and Problem Statement
Правило `n-flow.mdc` (`alwaysApply: true`) описувало контракт `n-cursor flow` — Dual-Mode Пасивний Турнікет із командами `flow init/verify/release`. Після переходу на нову `graph` архітектуру (`думка.MD`) концепція `flow` визнана застарілою і `n-cursor flow` повністю видалено. Проте правило продовжувало автоматично матеріалізуватись із bundled пакету `@nitra/cursor`.

## Considered Options
* Видалити лише `.cursor/rules/n-flow.mdc` вручну (без зміни конфігу)
* Додати `"flow"` до `disable-rules` у `.n-cursor.json`

## Decision Outcome
Chosen option: "Додати `"flow"` до `disable-rules` у `.n-cursor.json`", because видалення лише файлу без конфігу недостатнє — `npx @nitra/cursor` автоматично відновлює його з bundled пакету при кожному sync.

### Consequences
* Good, because `npx @nitra/cursor` більше не матеріалізує `n-flow.mdc`; sync підтвердив `− .cursor/rules/n-flow.mdc` у секції "видалено поза списком".
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінено: `/Users/vitaliytv/www/nitra/cursor/.n-cursor.json` — `"flow"` видалено з `rules[]`, додано до `disable-rules[]`
- Видалено: `.cursor/rules/n-flow.mdc`
- Sync команда: `npx @nitra/cursor` (без аргументів)
- Bundled джерело: `@nitra/cursor@4.1.0`
