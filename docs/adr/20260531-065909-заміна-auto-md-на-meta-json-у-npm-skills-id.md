---
session: 09dcb1bc-929b-4d88-90b0-c0611bed3d2f
captured: 2026-05-31T06:59:09+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/09dcb1bc-929b-4d88-90b0-c0611bed3d2f.jsonl
---

## ADR Заміна `auto.md` на `meta.json` у `npm/skills/<id>/`

## Context and Problem Statement
Скіли в `npm/skills/<id>/` мали `auto.md` — плоский текстовий файл з умовою автоактивації (`завжди` або `[rule,...]`). З потребою додати поле `worktree` виникло два варіанти: розширити `auto.md` або перейти на JSON. Плоский формат не масштабується, і наявність двох різних файлів метаданих (один для `auto`, інший для `worktree`) порушила б принцип єдиного джерела правди.

## Considered Options
* Залишити `auto.md`, додати окремий `worktree.md`
* Замінити `auto.md` на `meta.json` з полями `auto` і `worktree`
* Розширити синтаксис `auto.md` (YAML-frontmatter)

## Decision Outcome
Chosen option: "Замінити `auto.md` на `meta.json`", because JSON підтримує кілька полів без додаткового парсингу, легко валідується схемою (`npm/schemas/skill-meta.json`), і дозволяє додавати нові поля в майбутньому (наприклад, у Spec B для rules).

Формат: `{ "auto": "завжди" | ["rule-id",...], "worktree": true | false }`, де `auto` — опційне, `worktree` — обовʼязкове булеве.

### Consequences
* Good, because transcript фіксує очікувану користь: єдиний файл метаданих на скіл замість двох; `discoverSkillAutoActivation` в `auto-skills.mjs` читає одне джерело.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Міграція 9 скілів: `npm/skills/*/auto.md` видаляється, `npm/skills/*/meta.json` створюється.
- `auto.md` видаляється повністю — без deprecation-fallback.
- Валідація: `npm/schemas/skill-meta.json` + check-концерн `npm/rules/npm-module/js/skill_meta.mjs`.
- Файл плану: `docs/superpowers/plans/2026-05-31-skill-meta-json-worktree.md` (коміт `f53b097`).
- Spec: `docs/superpowers/specs/2026-05-31-skill-meta-json-worktree-design.md` (коміт `79e38d1`).

---

## ADR Літерал `"завжди"` залишається українською у `meta.json`

## Context and Problem Statement
При дизайні `meta.json` виникло питання: яким рядком позначати умову «активувати завжди» — `"always"` (англ.) чи `"завжди"` (укр., як у чинному `auto.md`). Вибір впливає на сумісність з наявним парсером `parseSkillAutoSpec` у `auto-skills.mjs`.

## Considered Options
* `"always"` (англ.) — нейтральна технічна назва
* `"завжди"` (укр.) — 1:1 з поточним літералом у коді

## Decision Outcome
Chosen option: `"завжди"`, because константа `ALWAYS_LITERAL = 'завжди'` вже захардкоджена в `auto-skills.mjs`; зміна на `"always"` зламала б парсер без додаткової міграції літерала. Закоміченні spec паралельної сесії містили `"always"` і були визнані помилковими — виправлено в канонічному spec.

### Consequences
* Good, because transcript фіксує очікувану користь: нульова міграція парсера; `detectAutoSkills` залишається незмінним.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Помилку виявлено при звірці дублікату spec (`2026-05-31-meta-json-skill-worktree-design.md`) з погодженим дизайном; дублікат видалено (коміт `79e38d1`).

---

## ADR Scope Spec A — лише skills; rules data-driven (G1) відокремлено в Spec B

## Context and Problem Statement
Brainstorming охопив дві незалежні проблеми: (1) skills мають `auto.md` замість JSON і немає поля `worktree`; (2) 28 rules мають хардкоджений порядок і умови активації в коді (`AUTO_RULE_ORDER`, `AUTO_RULE_DEPENDENCIES`). Обидві можна вирішити через `meta.json`, але разом вони подвоюють обсяг роботи.

## Considered Options
* Обʼєднати skills і rules в одному spec
* Розбити на два послідовних spec: Spec A (skills), Spec B (rules G1)

## Decision Outcome
Chosen option: "Розбити на два послідовних spec", because G1 (повний реєстр предикатів, порядок і залежності rules у `meta.json`) приблизно подвоює обсяг роботи відносно skills; окремий цикл spec→plan→impl для rules дає чистіші межі і не блокує Spec A.

### Consequences
* Good, because transcript фіксує очікувану користь: Spec A завершується швидше; «два механізми для rules» (issue E2-плану) зникають, бо rules взагалі не чіпаємо в Spec A.
* Bad, because до завершення Spec B rules і skills матимуть різні механізми метаданих (rules — хардкод у коді, skills — `meta.json`).

## More Information
- Spec A: `docs/superpowers/specs/2026-05-31-skill-meta-json-worktree-design.md`.
- Spec B описано у Forward ref у тому самому spec: «data-driven автодетект rules (G1)».

---

## ADR Кросплатформний worktree-інструмент: CLI-команда + тонкий skill

## Context and Problem Statement
Для ізоляції роботи агента в git-worktree наявний харнес Claude Code надає `EnterWorktree` — Anthropic-специфічний інструмент, що кладе worktree в `.claude/worktrees/` і не доступний у Cursor. Потрібен інструмент, однаково доступний в обох середовищах і незалежний від конкретного LLM-харнесу.

## Considered Options
* `EnterWorktree` (нативний інструмент Claude Code)
* Підкоманда CLI `n-cursor worktree` (виконавець) + тонкий skill (покажчик агенту)
* Лише skill/markdown-правило без CLI

## Decision Outcome
Chosen option: "CLI-команда + тонкий skill", because CLI (`npx @nitra/cursor worktree add <branch>`) є ідентичним в Claude, Cursor і терміналі незалежно від харнесу; skill слугує тонким покажчиком агенту, що саме викликати. Логіка створення інвентарного файлу `.worktrees/<branch>.md` переноситься безпосередньо в CLI-команду, а не залишається на дисципліні агента.

### Consequences
* Good, because transcript фіксує очікувану користь: однакова поведінка в Claude і Cursor; `EnterWorktree` більше не потрібен для типового worktree-флоу.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Конвенція розташування: `.worktrees/<branch>/` у корені репо (gitignored), інвентарний файл `.worktrees/<branch>.md` (також gitignored).
- Правило: `.cursor/rules/n-worktrees.mdc` (коміт `1838e44`).
- `EnterWorktree` захардкоджено класти в `.claude/worktrees/` — ця директорія заборонена для ручних змін у `cursor/CLAUDE.md`.
