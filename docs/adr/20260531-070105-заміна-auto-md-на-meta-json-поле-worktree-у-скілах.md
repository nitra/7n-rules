---
session: 09dcb1bc-929b-4d88-90b0-c0611bed3d2f
captured: 2026-05-31T07:01:05+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/09dcb1bc-929b-4d88-90b0-c0611bed3d2f.jsonl
---

<fim_suffix>
---

## ADR Заміна `auto.md` на `meta.json` + поле `worktree` у скілах

## Context and Problem Statement
Скіли в `npm/skills/<id>/` використовували плоский текстовий файл `auto.md` для оголошення умов автоактивації (`завжди` або список тригер-правил). Із появою потреби додати структуроване булеве поле `worktree` (чи виконувати скіл в ізольованому git-worktree) плоский формат перестав бути достатнім — потрібен JSON з кількома полями та можливістю валідації схемою.

## Considered Options
* Залишити `auto.md` як є і додати окремий `worktree.md` (два файли-прапорці)
* Замінити `auto.md` на `meta.json` з полями `auto` і `worktree`
* Залишити `auto.md` як fallback з deprecation-warning і паралельно підтримувати `meta.json`

## Decision Outcome
Chosen option: "Замінити `auto.md` на `meta.json`", because це усуває дублювання джерела правди (один файл на скіл замість двох), дозволяє JSON-схемну валідацію (`npm/schemas/skill-meta.json`), і зберігає 1:1 семантику нинішнього `auto.md` (ключ `auto` з тим самим рядком `"завжди"` або масивом тригерів).

### Consequences
* Good, because `discoverSkillAutoActivation` у `auto-skills.mjs` читає один JSON замість файлу-тексту; парсер `parseSkillAutoSpec` адаптується до JSON-значення без зміни зовнішньої поведінки `detectAutoSkills`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Формат: `{ "auto": "завжди" | ["rule",...], "worktree": true|false }` — `auto` опційне, `worktree` обовʼязкове булеве.
- Таблиця розкладки 9 скілів: `adr-normalize`→`["adr"]`/`true`, `coverage-fix`→`["js-lint"]`/`true`, `fix`→`"завжди"`/`true`, `fix-tests`→`["js-lint"]`/`true`, `taze`→`["bun"]`/`true`, `lint`→`"завжди"`/`false`, `llm-patch`→`"завжди"`/`false`, `publish-telegram`→`"завжди"`/`false`, `start-check`→`"завжди"`/`false`.
- Схема: `npm/schemas/skill-meta.json` (draft-07, `auto` — `oneOf[string, array]`, `worktree` — `boolean`, required).
- Check-концерн: `npm/rules/npm-module/js/skill_meta.mjs` — перевіряє, що кожен `skills/<id>/` має валідний `meta.json` і `auto.md` більше не існує.
- D2-sync у `syncSkills` (`n-cursor.js`): при `worktree: true` вшиває ідемпотентний блок між маркерами `<!-- n-cursor:worktree:start -->` / `<!-- n-cursor:worktree:end -->` у `.cursor/skills/n-<id>/SKILL.md`; при `false` видаляє блок при ре-синку.
- Принцип: `worktree: true` — генеративні скіли (детерміноване джерело змін); `false` — реактивні (lint, read-only, незакомічені зміни).
- Файли плану: `docs/superpowers/plans/2026-05-31-skill-meta-json-worktree.md` (коміт `f53b097`), spec: `docs/superpowers/specs/2026-05-31-skill-meta-json-worktree-design.md` (коміт `79e38d1`).

---

## ADR Worktree-конвенція: розташування `.worktrees/` і інвентарний `.md`-опис

## Context and Problem Statement
Проєкт використовує git-worktree для ізольованого виконання скілів. До сесії не було єдиної угоди: харнес Claude Code складав worktree у `.claude/worktrees/` (захардкоджено в `EnterWorktree`), тоді як sibling-каталоги (`../cursor-ci-bump`) виникали ситуативно. Потрібна була LLM-незалежна конвенція — однакова і для Claude Code, і для Cursor — де зберігати worktree і як документувати їхнє призначення для інвентаризації.

## Considered Options
* Використовувати `.claude/worktrees/` (дефолт `EnterWorktree`)
* Зберігати у sibling-каталогах (`../cursor-<branch>`)
* Зберігати у `.worktrees/<branch>/` у корені репо з gitignore

## Decision Outcome
Chosen option: "`.worktrees/<branch>/` у корені репо з gitignore", because це LLM-незалежний шлях (не `.claude/`, не `../`), він зручний для `git worktree list`, і автоматично ігнорується git без забруднення дерева проєкту.

### Consequences
* Good, because transcript фіксує очікувану користь: інвентарний файл `.worktrees/<branch>.md` (поруч із checkout, не всередині) дозволяє `cat .worktrees/*.md` для огляду всіх активних worktree і їхнього призначення без додаткових команд.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `.worktrees/` додано до `.gitignore` (коміт `1838e44`).
- Правило `.cursor/rules/n-worktrees.mdc` (`alwaysApply: true`) — описує конвенцію для агентів (де зберігати, формат інвентарного `.md`, заборона кластись в `.claude/worktrees/` і sibling).
- `CLAUDE.md` проєкту включає `@.cursor/rules/n-worktrees.mdc`.
- Логіка створення інвентарного `.n-worktree.md` переноситься у CLI-tool `n-cursor worktree add` (рішення C з brainstorming), а не лишається на дисципліні агента.

---

## ADR Власний CLI-інструмент `n-cursor worktree` замість `EnterWorktree`

## Context and Problem Statement
Харнес Claude Code надає нативний інструмент `EnterWorktree`, але він захардкоджує шлях `.claude/worktrees/` і є Anthropic-специфічним — недоступним у Cursor або терміналі. Користувач хотів єдиний worktree-інструмент, що однаково працює в Claude Code, Cursor і терміналі без залежності від конкретного харнесу.

## Considered Options
* Використовувати `EnterWorktree` (нативний інструмент Claude Code)
* Підкоманда CLI `n-cursor worktree` (виконавець конвенції)
* CLI + тонкий skill (skill вказує агенту викликати CLI)

## Decision Outcome
Chosen option: "CLI + тонкий skill (`n-cursor worktree` + skill)", because CLI-команда є єдиною формою, що дає ідентичну поведінку в Claude, Cursor і терміналі без залежності від харнесу; skill слугує тонким адаптером, що вказує агенту яку команду викликати.

### Consequences
* Good, because transcript фіксує очікувану користь: CLI-команда атомарно виконує `git worktree add` + створює інвентарний `.n-worktree.md` за конвенцією — логіку більше не покладено на дисципліну агента.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Набір підкоманд: `add`, `remove`, `list`, `prune` (D3 з brainstorming).
- `add` і `remove` — мутуючі операції (worktree + інвентарний `.md`).
- `list` — обʼєднує `git worktree list` з вмістом `.md`-описів у єдиний вивід.
- `prune` — прибирання «осиротілих» (worktree видалено, а `.md` лишився, або навпаки).
- Команда лягає в наявний диспетчер `npm/bin/n-cursor.js` (як `case 'worktree'`).
- Spec B (rules → той самий `meta.json` з data-driven автодетектом G1) — окрема задача, не включена в цей ADR.
<fim_prefix>

## ADR Заміна `auto.md` на `meta.json` + поле `worktree` у скілах

## Context and Problem Statement
Скіли в `npm/skills/<id>/` використовували плоский текстовий файл `auto.md` для оголошення умов автоактивації (`завжди` або список тригер-правил). Із появою потреби додати структуроване булеве поле `worktree` (чи виконувати скіл в ізольованому git-worktree) плоский формат перестав бути достатнім — потрібен JSON з кількома полями та можливістю валідації схемою.

## Considered Options
* Залишити `auto.md` як є і додати окремий `worktree.md` (два файли-прапорці)
* Замінити `auto.md` на `meta.json` з полями `auto` і `worktree`
* Залишити `auto.md` як fallback з deprecation-warning і паралельно підтримувати `meta.json`

## Decision Outcome
Chosen option: "Замінити `auto.md` на `meta.json`", because це усуває дублювання джерела правди (один файл на скіл замість двох), дозволяє JSON-схемну валідацію (`npm/schemas/skill-meta.json`), і зберігає 1:1 семантику нинішнього `auto.md` (ключ `auto` з тим самим рядком `"завжди"` або масивом тригерів).

### Consequences
* Good, because `discoverSkillAutoActivation` у `auto-skills.mjs` читає один JSON замість файлу-тексту; парсер `parseSkillAutoSpec` адаптується до JSON-значення без зміни зовнішньої поведінки `detectAutoSkills`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Формат: `{ "auto": "завжди" | ["rule",...], "worktree": true|false }` — `auto` опційне, `worktree` обовʼязкове булеве.
- Таблиця розкладки 9 скілів: `adr-normalize`→`["adr"]`/`true`, `coverage-fix`→`["js-lint"]`/`true`, `fix`→`"завжди"`/`true`, `fix-tests`→`["js-lint"]`/`true`, `taze`→`["bun"]`/`true`, `lint`→`"завжди"`/`false`, `llm-patch`→`"завжди"`/`false`, `publish-telegram`→`"завжди"`/`false`, `start-check`→`"завжди"`/`false`.
- Схема: `npm/schemas/skill-meta.json` (draft-07, `auto` — `oneOf[string, array]`, `worktree` — `boolean`, required).
- Check-концерн: `npm/rules/npm-module/js/skill_meta.mjs` — перевіряє, що кожен `skills/<id>/` має валідний `meta.json` і `auto.md` більше не існує.
- D2-sync у `syncSkills` (`n-cursor.js`): при `worktree: true` вшиває ідемпотентний блок між маркерами `<!-- n-cursor:worktree:start -->` / `<!-- n-cursor:worktree:end -->` у `.cursor/skills/n-<id>/SKILL.md`; при `false` видаляє блок при ре-синку.
- Принцип: `worktree: true` — генеративні скіли (детерміноване джерело змін); `false` — реактивні (lint, read-only, незакомічені зміни).
- Файли плану: `docs/superpowers/plans/2026-05-31-skill-meta-json-worktree.md` (коміт `f53b097`), spec: `docs/superpowers/specs/2026-05-31-skill-meta-json-worktree-design.md` (коміт `79e38d1`).

---

## ADR Worktree-конвенція: розташування `.worktrees/` і інвентарний `.md`-опис

## Context and Problem Statement
Проєкт використовує git-worktree для ізольованого виконання скілів. До сесії не було єдиної угоди: харнес Claude Code складав worktree у `.claude/worktrees/` (захардкоджено в `EnterWorktree`), тоді як sibling-каталоги (`../cursor-ci-bump`) виникали ситуативно. Потрібна була LLM-незалежна конвенція — однакова і для Claude Code, і для Cursor — де зберігати worktree і як документувати їхнє призначення для інвентаризації.

## Considered Options
* Використовувати `.claude/worktrees/` (дефолт `EnterWorktree`)
* Зберігати у sibling-каталогах (`../cursor-<branch>`)
* Зберігати у `.worktrees/<branch>/` у корені репо з gitignore

## Decision Outcome
Chosen option: "`.worktrees/<branch>/` у корені репо з gitignore", because це LLM-незалежний шлях (не `.claude/`, не `../`), він зручний для `git worktree list`, і автоматично ігнорується git без забруднення дерева проєкту.

### Consequences
* Good, because transcript фіксує очікувану користь: інвентарний файл `.worktrees/<branch>.md` (поруч із checkout, не всередині) дозволяє `cat .worktrees/*.md` для огляду всіх активних worktree і їхнього призначення без додаткових команд.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `.worktrees/` додано до `.gitignore` (коміт `1838e44`).
- Правило `.cursor/rules/n-worktrees.mdc` (`alwaysApply: true`) — описує конвенцію для агентів (де зберігати, формат інвентарного `.md`, заборона кластись в `.claude/worktrees/` і sibling).
- `CLAUDE.md` проєкту включає `@.cursor/rules/n-worktrees.mdc`.
- Логіка створення інвентарного `.n-worktree.md` переноситься у CLI-tool `n-cursor worktree add` (рішення C з brainstorming), а не лишається на дисципліні агента.

---

## ADR Власний CLI-інструмент `n-cursor worktree` замість `EnterWorktree`

## Context and Problem Statement
Харнес Claude Code надає нативний інструмент `EnterWorktree`, але він захардкоджує шлях `.claude/worktrees/` і є Anthropic-специфічним — недоступним у Cursor або терміналі. Користувач хотів єдиний worktree-інструмент, що однаково працює в Claude Code, Cursor і терміналі без залежності від конкретного харнесу.

## Considered Options
* Використовувати `EnterWorktree` (нативний інструмент Claude Code)
* Підкоманда CLI `n-cursor worktree` (виконавець конвенції)
* CLI + тонкий skill (skill вказує агенту викликати CLI)

## Decision Outcome
Chosen option: "CLI + тонкий skill (`n-cursor worktree` + skill)", because CLI-команда є єдиною формою, що дає ідентичну поведінку в Claude, Cursor і терміналі без залежності від харнесу; skill слугує тонким адаптером, що вказує агенту яку команду викликати.

### Consequences
* Good, because transcript фіксує очікувану користь: CLI-команда атомарно виконує `git worktree add` + створює інвентарний `.n-worktree.md` за конвенцією — логіку більше не покладено на дисципліну агента.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Набір підкоманд: `add`, `remove`, `list`, `prune` (D3 з brainstorming).
- `add` і `remove` — мутуючі операції (worktree + інвентарний `.md`).
- `list` — обʼєднує `git worktree list` з вмістом `.md`-описів у єдиний вивід.
- `prune` — прибирання «осиротілих» (worktree видалено, а `.md` лишився, або навпаки).
- Команда лягає в наявний диспетчер `npm/bin/n-cursor.js` (як `case 'worktree'`).
- Spec B (rules → той самий `meta.json` з data-driven автодетектом G1) — окрема задача, не включена в цей ADR.
