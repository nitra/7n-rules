---
session: a7aaf3f9-4bd7-4990-b47f-f8212d971f58
captured: 2026-05-21T13:39:36+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/a7aaf3f9-4bd7-4990-b47f-f8212d971f58/a7aaf3f9-4bd7-4990-b47f-f8212d971f58.jsonl
---

## ADR Додавання skills CLI до пакета `@nitra/cursor`

## Context and Problem Statement
Скіли з `@nitra/cursor` можна було запускати лише через `n-cursor` у репозиторії, де пакет установлено як devDependency. Потрібен спосіб запускати ті самі скіли з будь-якого проєкту через `npx`, без встановлення пакета та без синку правил у цільовий проєкт.

## Considered Options
* Окремий пакет `@nitra/skills` із власним bin і структурою `skills/<id>/SKILL.md`
* Додати skills CLI безпосередньо до `@nitra/cursor` — нові bin `n-skills` і підкоманда `skill` у `n-cursor`

## Decision Outcome
Chosen option: "Додати skills CLI до `@nitra/cursor`", because скіли вже існують у `npm/skills/<id>/SKILL.md` цього ж пакета, дублювати структуру в окремий пакет не потрібно; один `npx @nitra/cursor skill …` дає доступ до всіх скілів без зайніх публікацій.

### Consequences
* Good, because transcript фіксує очікувану користь: будь-який репозиторій може запустити скіл через `npx @nitra/cursor skill lint "завдання"` без локального встановлення.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/scripts/skills-cli.mjs` — логіка `list`, `prompt`, `claude`, `cursor`; підтримка скороченого `skill <id> "task"` без `prompt`
- `npm/bin/n-skills.js` — окремий bin, alias до `n-cursor skill …`
- `npm/bin/n-cursor.js` — додана підкоманда `case 'skill'`
- `npm/scripts/skills-cli.test.mjs` — юніт-тести: `list`, `normalizeSkillId`, `buildSkillPrompt`, shorthand
- Промпт збирає: `SKILL.md` із пакета + завдання + контекст CWD (`package.json`, `tsconfig.json`, `.n-cursor.json`)
- Версія `1.13.70`, команди: `npx @nitra/cursor skill list`, `skill prompt <id>`, `skill claude <id>`, `skill cursor <id>`

---

## ADR Claude-first UX для запуску скілів

## Context and Problem Statement
Після появи `skill claude taze` користувач попросив інвертований порядок: щоб термінальна команда виглядала як `claude taze` — тобто «запускач» першим, скіл аргументом, за аналогією з нативним Claude CLI.

## Considered Options
* Bin із іменем `claude` у пакеті `@nitra/cursor`
* Нова підкоманда `claude` у `n-cursor` + bin `n-claude`; alias у shell для термінального `claude taze`

## Decision Outcome
Chosen option: "Підкоманда `claude` у `n-cursor` + bin `n-claude`", because ім'я bin `claude` конфліктує з Anthropic Claude Code CLI — після глобальної установки обидва боролися б за одну команду; `n-claude` безпечно співіснує. Alias у `~/.zshrc` дає точний UX `claude taze` для тих, хто хоче його.

### Consequences
* Good, because `npx @nitra/cursor claude taze` і `npx -p @nitra/cursor n-claude taze` працюють без конфлікту з Anthropic CLI; transcript фіксує очікувану користь.
* Bad, because Neutral, because transcript не містить підтвердження наслідку: користувач ще не підтвердив, що alias-підхід задовольняє потребу.

## More Information
- `npm/bin/n-claude.js` — новий bin; `runClaudeFirstSkillsCli` з `skills-cli.mjs`
- `npm/bin/n-cursor.js` — `case 'claude': runClaudeFirstSkillsCli(args)`
- `npm/scripts/skills-cli.mjs` — `mapClaudeFirstArgv` перетворює `[skillId, ...task]` → `['claude', skillId, ...task]`; `CLAUDE_FIRST_USAGE_LINES` — help-текст
- `npm/scripts/skills-cli.test.mjs` — тести `mapClaudeFirstArgv` і `runClaudeFirstSkillsCli`
- Рекомендований alias: `alias ccode='command claude'; claude() { npx -p @nitra/cursor n-claude "$@"; }`
- Версія `1.13.71`, форми: `npx @nitra/cursor claude taze`, `npx -p @nitra/cursor n-claude taze`, `n-claude list`
