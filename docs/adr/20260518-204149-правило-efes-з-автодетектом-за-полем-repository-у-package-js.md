---
session: 6a761d41-5ab2-4090-94dc-dcb7c552db04
captured: 2026-05-18T20:41:49+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/6a761d41-5ab2-4090-94dc-dcb7c552db04.jsonl
---

## ADR Правило efes з автодетектом за полем `repository` у `package.json`

## Context and Problem Statement
Потрібно додати правило `efes` до системи правил `@nitra/cursor`, яке автоматично вмикається для проєктів Efes Cloud. Аналогічний механізм вже існує для `abie` (AbInBev Efes) — за маркером у полі `repository` у `package.json`.

## Considered Options
* Автодетект за полем `repository` у кореневому `package.json` (за аналогією з `abie`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Автодетект за полем `repository` у кореневому `package.json`", because у transcript явно задана умова «якщо в `package.json` в `"repository"` починається з `https://github.com/efes-cloud`», і реалізація наслідує вже наявний патерн `ABIE_REPOSITORY_URL_MARKER`.

### Consequences
* Good, because transcript фіксує очікувану користь: правило вмикається автоматично без ручної конфігурації для всіх репозиторіїв під `github.com/efes-cloud`, аналогічно до `abie`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Нові файли: `npm/rules/efes/efes.mdc`, `npm/rules/efes/auto.md`
- Змінені файли: `npm/scripts/auto-rules.mjs` (додано `EFES_REPOSITORY_URL_MARKER = 'https://github.com/efes-cloud/'`, `isEfes`-змінна, `'efes'` у масиві правил і в масиві `enabled`-записів), `npm/scripts/auto-rules.test.mjs` (додано `'efes'` до `ALL_RULES` і тест-кейс детекту)
- Версія пакету: `1.13.41` → `1.13.42`, запис у `npm/CHANGELOG.md`
- Умова активації (з `auto.md`): `якщо в кореневому package.json в секції "repository" присутній текст "https://github.com/efes-cloud/**/"`
- Тести пройшли: 27 pass, 0 fail (`bun test scripts/auto-rules.test.mjs`)
