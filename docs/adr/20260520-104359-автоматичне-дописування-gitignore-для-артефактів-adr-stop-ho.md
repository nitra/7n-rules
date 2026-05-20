---
session: 748f86db-97db-4b20-81dd-f9fe88d716b5
captured: 2026-05-20T10:43:59+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/748f86db-97db-4b20-81dd-f9fe88d716b5/748f86db-97db-4b20-81dd-f9fe88d716b5.jsonl
---

## ADR Автоматичне дописування `.gitignore` для артефактів ADR Stop-hook'ів

## Context and Problem Statement
Локальні артефакти ADR Stop-hook'ів (`.claude/hooks/capture-decisions.log`, `.claude/hooks/normalize-decisions.log`, `.claude/hooks/.normalize-state`, `.claude/hooks/.normalize.lock`) потрапляли в Changes споживчих репозиторіїв, що засмічувало git-статус. Потрібно було визначити, де зберігати канонічний перелік шаблонів ігнорування і як доставляти їх у проєкти.

## Considered Options
* Канонічний `.gitignore.snippet` у пакеті + автоматичне злиття під час `npx @nitra/cursor`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Канонічний `.gitignore.snippet` у пакеті + автоматичне злиття під час `npx @nitra/cursor`", because це забезпечує однаковий набір шаблонів для всіх споживачів без ручних кроків і не конфліктує з власними записами `.gitignore` у проєкті.

### Consequences
* Good, because `npx @nitra/cursor` сам дописує відсутні рядки до кореневого `.gitignore` споживача (без дублювання), коли в `.n-cursor.json` увімкнено правило `adr`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Новий файл-шаблон: `npm/rules/adr/fix/hooks/template/.gitignore.snippet`
Містить рядки: `.claude/hooks/*.log`, `.claude/hooks/.normalize-state`, `.claude/hooks/.normalize.lock`
- Логіка злиття додана до `npm/scripts/sync-claude-config.mjs` (нова функція `mergeGitignore` або аналогічна), константа `ADR_GITIGNORE_SNIPPET_REL`
- Повернутий прапорець `gitignore` у результаті `syncClaudeConfig`
- Повідомлення у CLI (`npm/bin/n-cursor.js`) виводить шлях `.gitignore` після злиття
- Правило `npm/rules/adr/adr.mdc` оновлено: вимога покриття `.claude/hooks/*.log` і `.claude/hooks/.normalize-*` тепер вказує на кореневий `.gitignore`
- Тести: `npm/scripts/sync-claude-config.test.mjs` — доданий тест «дописує канонічний фрагмент у .gitignore»
- Версія пакета підвищена: `1.13.63` → `1.13.64`, запис у `npm/CHANGELOG.md`
