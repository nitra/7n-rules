---
session: 4a6350d4-09fc-48ad-b274-e81cf19e7e26
captured: 2026-05-17T16:33:58+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/4a6350d4-09fc-48ad-b274-e81cf19e7e26.jsonl
---

## ADR Inline template-контент у `.mdc` під час sync (варіант вибору)

## Context and Problem Statement
`npm/rules/security/security.mdc` містить markdown-посилання типу `[…](./policy/package_json/template/package.json.snippet.json)` після Phase 0+1 реалізації. При sync через `n-cursor` CLI до `.cursor/rules/n-security.mdc` копіюється лише сам `.mdc`-файл без сусідніх директорій, тому посилання ведуть у нікуди на боці споживача.

## Considered Options
* Інлайнити вміст `template/<file>` у fenced-блок у місці лінка під час sync (`inlineTemplateLinks` у `readBundledRuleContent`)
* Замінити лінки на абсолютні GitHub URL
* Копіювати `template/` до `.cursor/rules-data/<id>/…` і переписувати лінки під час sync

## Decision Outcome
Chosen option: "Інлайнити вміст під час sync", because `.mdc`-файл повинен бути self-contained для споживача — так само, як він є зараз без template-інфраструктури; GitHub URL потребують мережі та можуть розʼїхатись із встановленою версією; третій варіант створює дві локації одного канону.

### Consequences
* Good, because transcript фіксує очікувану користь: `.cursor/rules/n-security.mdc` після sync містить повний TOML і JSON-канон у fenced-блоках без зовнішніх залежностей.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Реалізація: `npm/scripts/utils/inline-template-links.mjs`, хук у `readBundledRuleContent` в `npm/bin/n-cursor.js` (коміти `2f36015`, `ede7754`)
- Фільтр лінків — regex `\(\.\/[^)]*\/template\/[^)]+\)`: інлайниться лише шляхи з `/template/`; зовнішні URL та посилання на сусідні `.md` не чіпаються
- Якщо файл відсутній — sync кидає виняток (fail hard), щоб помилка була помітна

---

## ADR Fail hard при відсутності template-файла в `inlineTemplateLinks`

## Context and Problem Statement
Під час проектування `inlineTemplateLinks` постало питання: що робити, якщо `.mdc`-файл посилається на `template/<file>`, якого немає на диску — пропустити тихо чи зупинити sync з помилкою.

## Considered Options
* Fail-safe: лишити лінк як є без винятку
* Fail hard: кидати помилку з повідомленням типу `inlineTemplateLinks: ${rel} (referenced in ${ruleId}.mdc) не знайдено`

## Decision Outcome
Chosen option: "Fail hard", because user явно уточнив: «потрібно фейлити щоб було замітно для користувача» — тихий пропуск заховує помилку конфігурації.

### Consequences
* Good, because transcript фіксує очікувану користь: помилка одразу видима на CI та при локальному sync.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Реалізація у `npm/scripts/utils/inline-template-links.mjs`; тест `npm/scripts/utils/inline-template-links.test.mjs` покриває цей сценарій

---

## ADR Function-replacer у `String.replace` для уникнення інтерпретації `$`-патернів

## Context and Problem Statement
`inlineTemplateLinks` використовував `result.replace(fullMatch, replacement)` де `replacement` — рядок із вмістом template-файла. TOML-файли (зокрема `.gitleaks.toml.snippet.toml`) містять TOML raw-strings виду `'''.*\.lock$'''`, де підрядок `$'` JavaScript інтерпретує як «текст після матчу», що призводило до спотворення `.mdc`-файла після sync.

## Considered Options
* Використати function-replacer: `result.replace(fullMatch, () => replacement)`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Function-replacer `() => replacement`", because function-replacer у `String.replace` пригнічує інтерпретацію `$&`, `$'`, `$\``, `$n` у рядку заміни.

### Consequences
* Good, because transcript фіксує очікувану користь: `.cursor/rules/n-security.mdc` після sync містить коректний TOML-блок без артефактів `$`-підстановки; тест 10/10.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Файл: `npm/scripts/utils/inline-template-links.mjs`, рядок із `result.replace(fullMatch, () => replacement)`
- Регресійний тест із фікстурою `npm/scripts/utils/__fixtures__/inline-template/fix/foo/template/with-dollar.toml` (`paths = ['''.*\\.lock$''']`)
- Коміт `6df1de2 fix(npm): inlineTemplateLinks — escape $-patterns in replacement (use function replacer)`
- Версія `npm/package.json`: `1.13.6` → `1.13.7`
