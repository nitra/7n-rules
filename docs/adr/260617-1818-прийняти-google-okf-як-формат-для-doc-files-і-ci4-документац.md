---
session: 00b0f0eb-0129-4927-975d-23b80fa903f4
captured: 2026-06-17T18:18:07+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/00b0f0eb-0129-4927-975d-23b80fa903f4.jsonl
---

## ADR Прийняти Google OKF як формат для doc-files і ci4-документації

## Context and Problem Statement
Документація у `docs/` (doc-files, ADR, ci4) зберігається у Markdown без стандартизованого YAML frontmatter і без маніфесту бандлу, тому LLM-агенти не можуть автоматично навігувати нею через OKF-сумісний інтерфейс. Google Cloud опублікував Open Knowledge Format (OKF) v0.1 — vendor-neutral Markdown-специфікацію з YAML frontmatter і `_index.md`-маніфестом для надання AI-агентам структурованого контексту.

## Considered Options
* Прийняти OKF: додати YAML frontmatter до всіх doc-files і `docs/_index.md`-маніфест
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Прийняти OKF", because користувач явно поставив задачу зробити ci4-документацію та doc-files сумісними з OKF, і аналіз gap-аналізу підтвердив конкретні кроки без суттєвих заперечень.

### Consequences
* Good, because LLM-агенти зможуть навігувати `docs/` через OKF-сумісний маніфест і читати структурований контекст із frontmatter-полів (`type`, `topics`, `audience`, `updated`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Обов'язкові поля OKF frontmatter: `title`, `description`, `type` (overview | reference | guide | faq | changelog | example), `topics`, `audience`, `updated`, `version`. Файли для зміни: `.cursor/rules/n-ci4.mdc`, `docs/doc-files-skill.md`, шаблони `n-docgen`. Додати: `docs/_index.md` як маніфест бандлу.

---

## ADR Єдиний OKF-бандл `docs/` замість окремих бандлів

## Context and Problem Statement
При введенні OKF виникло питання — чи робити окремий бандл для `docs/adr/` (щоб ADR-рішення були доступні LLM-агентам незалежно), чи включити їх до єдиного бандлу `docs/`.

## Considered Options
* Єдиний бандл `docs/` з одним `docs/_index.md`
* Окремий бандл `docs/adr/` з власним `_index.md`

## Decision Outcome
Chosen option: "Єдиний бандл `docs/`", because окремий бандл для ADR — надлишковий (слова користувача), і єдиний маніфест `docs/_index.md` автоматично охоплює `docs/adr/*.md` без додаткової підтримки.

### Consequences
* Good, because transcript фіксує очікувану користь: ADR-файли стають доступними LLM-агентам через OKF без додаткової інфраструктури — один `_index.md` покриває всі підтеки.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Поточні ADR-файли вже мають YAML frontmatter згідно MADR v4 (`title`, `status`, `date`) — вони частково OKF-сумісні. Не вистачає: поля `type:` (мепінг MADR `status:` → OKF `type:`), `topics:`, `audience:`. Маніфест `docs/_index.md` є єдиною точкою входу OKF-бандлу для всієї `docs/`.
