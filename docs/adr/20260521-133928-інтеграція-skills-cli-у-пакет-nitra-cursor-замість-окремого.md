---
session: a7aaf3f9-4bd7-4990-b47f-f8212d971f58
captured: 2026-05-21T13:39:28+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/a7aaf3f9-4bd7-4990-b47f-f8212d971f58/a7aaf3f9-4bd7-4990-b47f-f8212d971f58.jsonl
---

## ADR Інтеграція skills CLI у пакет `@nitra/cursor` замість окремого пакета

## Context and Problem Statement
Потрібно запускати скіли `@nitra/cursor` у зовнішніх проєктах без встановлення пакета і без синку правил у проєкт. Користувач навів приклад реалізації через окремий пакет `@nitra/skills` з власним bin.

## Considered Options
* Створити окремий пакет `@nitra/skills` з bin `skills.js`
* Додати skills CLI безпосередньо до існуючого пакета `@nitra/cursor`

## Decision Outcome
Chosen option: "Додати skills CLI до `@nitra/cursor`", because дозволяє уникнути нового пакета — скіли вже є в `npm/skills/`, а `npx @nitra/cursor` вже доступний у зовнішніх проєктах.

### Consequences
* Good, because transcript фіксує очікувану користь: `npx @nitra/cursor skill list` і `npx @nitra/cursor skill claude taze` працюють без `devDependencies` у чужому проєкті.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/scripts/skills-cli.mjs` — логіка `list`, `prompt`, `claude`, `cursor`, shorthand `<id>` без `prompt`
- `npm/bin/n-skills.js` — окремий bin `n-skills` (alias до `n-cursor skill …`)
- `npm/bin/n-cursor.js` — нова підкоманда `skill`
- `npm/package.json` — bin `n-skills` додано поряд з `n-cursor`; версія bumped до `1.13.70`
- Промпт містить: `skills/<id>/SKILL.md` + завдання + `package.json` / `tsconfig.json` / `.n-cursor.json` з CWD

---

## ADR Claude-first UX — `claude <skill>` як підкоманда замість `skill claude <skill>`

## Context and Problem Statement
Після появи `skill claude taze` користувач запитав, як зробити щоб командою була `claude`, а скіл — першим аргументом, тобто `npx @nitra/cursor claude taze`.

## Considered Options
* Залишити лише `npx @nitra/cursor skill claude <id>` (skill-first UX)
* Додати інвертований варіант: підкоманда `claude` у `n-cursor` + окремий bin `n-claude`

## Decision Outcome
Chosen option: "Додати підкоманду `claude` і bin `n-claude`", because дає природніший порядок аргументів — спочатку «запускач», потім скіл — та відповідає запиту користувача.

### Consequences
* Good, because transcript фіксує очікувану користь: `npx @nitra/cursor claude taze` і `npx -p @nitra/cursor n-claude lint "task"` працюють.
* Bad, because bin не може називатися `claude` — збігається з Anthropic Claude Code CLI; при глобальній установці обидва конкурують за одну команду. Замість `claude` використано `n-claude`.

## More Information
- `npm/bin/n-claude.js` — новий bin, делегує до `runClaudeFirstSkillsCli`
- `npm/scripts/skills-cli.mjs` — нові експорти `runClaudeFirstSkillsCli`, `mapClaudeFirstArgv`, `CLAUDE_FIRST_USAGE_LINES`
- `npm/bin/n-cursor.js` — підкоманда `case 'claude'` делегує до `runClaudeFirstSkillsCli(args)`
- `npm/package.json` — bin `n-claude` додано; версія bumped до `1.13.71`
- Обхід конфлікту імен: alias у `~/.zshrc` (`alias ccode='command claude'`; `claude() { npx -p @nitra/cursor n-claude "$@" }`)
