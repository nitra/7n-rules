---
session: 09dcb1bc-929b-4d88-90b0-c0611bed3d2f
captured: 2026-05-31T06:38:46+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/09dcb1bc-929b-4d88-90b0-c0611bed3d2f.jsonl
---

Зрозумів причину. Глобальний хук `git-ai checkpoint claude` запускається після КОЖНОГО tool-use і виконує `git reset --hard origin/main`. Мої коміти ІСНУЮТЬ у reflog (`fc1b352 → 9af15cb → 942e0e6 → 64a4ece → 2a53c22`) і починаються від `bfc1bc2` (поточний `origin/main`), але після кожної команди хук їх скидає.

**Ланцюжок закомічених змін у reflog:**
```
fc1b352  feat(skill-meta,worktree-notice): нові хелпери
9af15cb  feat(skills,schemas): meta.json + видалення auto.md + JSON-схема
942e0e6  refactor(auto-skills,sync): читати meta.json + вшивати блок у SKILL.md
64a4ece  feat(npm-module): концерн валідації skills/<id>/meta.json
2a53c22  docs: scripts.mdc + README + change-файл (Spec A)
```

Щоб зміни стали постійними, потрібно або **запушити** `2a53c22` в `origin/main`, або відновити HEAD до `2a53c22` і тоді запушити. Оскільки пуш у `main` без явного дозволу — ризикована дія, я не роблю його сам.

**Рекомендую одне з двох:**

1. **Дозволь мені запушити** — я відновлю HEAD до `2a53c22` і зроблю `git push origin main` в одному виклику (після пушу `origin/main` = `2a53c22`, тож наступний reset хука буде no-op).
2. **Зроби вручну:**
```bash
git reset --hard 2a53c22
git push origin main
```

Яке рішення обрати?
[tool_result] was truncated, the full result is too long for assistant context (5248 characters truncated). The assistant has all relevant parts already. The decision ADR follows:
---

## ADR Міграція `skills/*/auto.md` → `meta.json` + поле `worktree`

## Context and Problem Statement
Файл `npm/skills/<id>/auto.md` — плоский рядок-умова автоактивації скіла (`завжди` / `[rule,...]`) — не міг нести додаткових метаданих. Виникла потреба додати поле `worktree` (чи виконувати скіл в окремому git-worktree) і при цьому зберегти машинно-парсовану умову автоактивації в одному структурованому джерелі.

## Considered Options
* Зберегти `auto.md`, додати окремий `worktree.json`
* Замінити `auto.md` на структурований `meta.json` (поля `auto` + `worktree`)
* Вшити `worktree` у YAML-frontmatter `SKILL.md`
* Інші варіанти в transcript не обговорювалися повністю, але були названі: `meta.yaml`, `meta.md` з frontmatter

## Decision Outcome
Chosen option: "Замінити `auto.md` на `meta.json`", because один JSON-файл об'єднує обидві осі (умова автоактивації + worktree), легко валідується JSON-схемою (`npm/schemas/skill-meta.json`), не потребує нових форматів, а існуюча інфраструктура (`auto-skills.mjs`, `n-cursor.js syncSkills`) вже парсить файли з каталогів скілів.

### Consequences
* Good, because transcript фіксує очікувану користь: одне джерело правди для метаданих скіла, підтримка валідації через JSON Schema draft-07 і check-концерн `npm-module/js/skill_meta.mjs`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Схема: `npm/schemas/skill-meta.json` (`worktree` обов'язкове boolean, `auto` опційне — `"завжди"` | масив рядків)
- Хелпери: `npm/scripts/lib/skill-meta.mjs` (`parseSkillAutoSpec`, `readSkillMetaRaw`), `npm/scripts/lib/worktree-notice.mjs` (`injectWorktreeNotice`)
- При синку (`syncSkills`): `meta.json` не копіюється в проєкт; при `worktree:true` у `.cursor/skills/n-<id>/SKILL.md` вшивається ідемпотентний блок між маркерами `<!-- n-cursor:worktree:start/end -->`
- Spec A: `docs/superpowers/specs/2026-05-31-skill-meta-json-worktree-design.md`
- Plan: `docs/superpowers/plans/2026-05-31-skill-meta-json-worktree.md`
- Commits (reflog): `fc1b352`, `9af15cb`, `942e0e6`, `64a4ece`, `2a53c22`

---

## ADR `worktree: true` скілів — семантика і принцип класифікації

## Context and Problem Statement
При введенні поля `worktree` у `meta.json` необхідно було визначити, яким скілам присвоїти `true` (виконання в окремому git-worktree) і яким `false`, і закріпити загальний принцип для майбутніх скілів.

## Considered Options
* Булеве `true`/`false`
* Enum з трьох станів (`required`/`allowed`/`forbidden`)
* Enum + окремий прапорець паралельності

## Decision Outcome
Chosen option: "Булеве `true`/`false`", because достатньо для всіх реальних випадків 9 скілів; `worktree:true` автоматично означає заборону паралельного запуску (один інстанс), що вже забезпечується `withLock`.

### Consequences
* Good, because transcript фіксує очікувану користь: простота схеми, відсутність надлишкових станів, паралельність вже захищена `withLock` на рівні реалізації.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Принцип класифікації (з transcript): `worktree:true` — для **генеративних** скілів (створюють зміни з детермінованого джерела: `fix`, `taze`, `coverage-fix`, `fix-tests`, `adr-normalize`); `worktree:false` — для **реактивних** (працюють на незакомічених змінах поточного checkout, як `lint`) і read-only (`llm-patch`, `publish-telegram`) і тих, де worktree конфліктує з природою скіла (`start-check` — конфлікт портів).
Міграція 9 скілів зафіксована у `npm/skills/<id>/meta.json`; commit `9af15cb`.

---

## ADR D2-sync: вшивання worktree-інструкції в `SKILL.md` через маркери

## Context and Problem Statement
Поле `worktree` у `meta.json` живе в пакеті й не копіюється в проєкт при синку. Агент читає `.cursor/skills/n-<id>/SKILL.md` під час виконання скіла, тому worktree-налаштування мусить потрапити саме туди.

## Considered Options
* YAML-frontmatter у копії `SKILL.md` (D1)
* Згенерована markdown-секція з маркерами в тілі (D2)
* І frontmatter, і секція (D3)

## Decision Outcome
Chosen option: "D2 — згенерована markdown-секція з маркерами", because агент читає `SKILL.md` як інструкцію, тому людиночитаний блок у тілі надійніше доносить вимогу, ніж frontmatter-поле. Маркери `<!-- n-cursor:worktree:start/end -->` забезпечують ідемпотентний ре-синк.

### Consequences
* Good, because transcript фіксує очікувану користь: agент бачить явну інструкцію; ре-синк ідемпотентний (наявний блок замінюється, при `worktree:false` видаляється).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Реалізація: `npm/scripts/lib/worktree-notice.mjs` (`injectWorktreeNotice`, `WORKTREE_START`, `WORKTREE_END`); commit `fc1b352`. Текст блоку: `> **Worktree:** виконуй цей скіл в окремому git-worktree (\`git worktree add\`); **не** запускай паралельно — один інстанс за раз.`

---

## ADR Spec B: data-driven автодетект правил через `meta.json` (відкладено)

## Context and Problem Statement
У пакеті `rules/<id>/auto.md` — 29 файлів з людинозрозумілою прозою умов. Логіка автодетекту захардкоджена в `npm/scripts/auto-rules.mjs` (`AUTO_RULE_ORDER`, `autoRuleChecks`, `collectAutoRuleFacts`). Під час brainstorming виникло питання про уніфікацію формату з `skills/*/meta.json`.

## Considered Options
* Повний data-driven + реєстр предикатів (G1)
* Гібрид: прості умови в дані, складні в коді (G2)
* Уніфікувати лише `auto`, порядок у коді (G3)

## Decision Outcome
Chosen option: "G1 — повний data-driven з реєстром предикатів", because єдине джерело правди для умов активації, предикат-реєстр — чесний компроміс для незводимих перевірок (gql-теги, deps, URL repo). Але реалізація **відкладена до Spec B** через значний обсяг (28 правил + переписування ядра `auto-rules.mjs`).

### Consequences
* Good, because transcript фіксує очікувану користь: уніфікований формат між rules і skills, усунення захардкодженої мапи у коді.
* Bad, because Neutral, because transcript не містить підтвердження наслідку — Spec B ще не почато.

## More Information
Spec B — окремий цикл spec→plan→impl після завершення Spec A. Частина правил (≈8) матиме `{"auto":{"predicate":"gqlTaggedTemplate"}}` з реалізацією в реєстрі; решта (≈20) — декларативні (`anyFile`, `pathExists`, `requiresRules`). Порядок і залежності (`AUTO_RULE_ORDER`) також переїдуть у `meta.json`. Додаткової інформації в transcript не зафіксовано — Spec B ще не написаний.
