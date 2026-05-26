---
session: b58fe9b6-2fb0-46ef-8ad3-b10064a423ed
captured: 2026-05-26T22:27:46+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/b58fe9b6-2fb0-46ef-8ad3-b10064a423ed.jsonl
---

## ADR Токен-регекс для виявлення prettier у package.json#scripts

## Context and Problem Statement
Rego-правило `text.package_json` не ловило команди з `prettier` у `package.json#scripts`, тому `npx @nitra/cursor fix text` не падав на скриптах типу `"fix": "bunx prettier --write ."`. Потрібно було виявляти всі форми виклику (`bunx prettier`, `npx prettier`, `prettier --write`) без false-positive на підрядки типу `not-prettier` чи `prettier-ignore`.

## Considered Options
* Простий `contains(cmd, "prettier")` — базова вимога з brief
* Token-based regex `(^|[\s/"'])prettier($|[\s'"@])` — уникає false-positive

## Decision Outcome
Chosen option: "Token-based regex", because transcript зафіксував явну вимогу уникнути false-positive на `not-prettier`/`prettier-ignore-substring`, яку `contains` не забезпечує.

### Consequences
* Good, because transcript фіксує очікувану користь: ловить `bunx prettier`, `npx prettier`, `./node_modules/.bin/prettier`, `prettier --write`, і не реагує на `not-prettier` у назвах скриптів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Файл: `npm/rules/text/policy/package_json/package_json.rego` — функція `script_invokes_prettier(cmd)` з `regex.match`
- Тести: `npm/rules/text/policy/package_json/package_json_test.rego` — 5 нових кейсів (deny для bunx/npx/bare/path, allow для oxfmt і `not-prettier`)
- `conftest verify -p npm/rules/text/policy/package_json/` → 13/13 passed

---

## ADR Окремий JS concern для заборонених Prettier-артефактів

## Context and Problem Statement
`formatting.mjs` містив hardcoded inline-список із 5 Prettier-файлів (`.prettierrc`, `.prettierrc.json`, `.prettierrc.js`, `prettier.config.js`, `.prettierrc.yml`), що не відповідав повному 3.x-переліку форматів і дублював майбутній concern. Потрібно було покрити всі актуальні конфігурації Prettier програмно.

## Considered Options
* Розширити наявний `formatting.mjs` — додати файли до існуючого циклу
* Новий JS concern `forbidden-prettier.mjs` — окремий файл, auto-discovered runner-ом
* Declarative `files.forbiddenSingle`/`files.forbiddenGlob` у `target.json` — системна зміна runner-а

## Decision Outcome
Chosen option: "Новий JS concern `forbidden-prettier.mjs`", because brief явно вказав: "для цього завдання достатньо JS concern, бо runner already supports `rules/<id>/js/*.mjs`" і рекомендував уникати ширших змін runner-а.

### Consequences
* Good, because transcript фіксує очікувану користь: inline-список у `formatting.mjs` видалено, канонічне місце — `forbidden-prettier.mjs`, повний перелік форматів Prettier 3.x (`.prettierrc.{json,jsonc,json5,yaml,yml,toml,js,cjs,mjs,ts,cts,mts}`, `prettier.config.{js,cjs,mjs,ts,cts,mts}`) в одному місці.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Новий файл: `npm/rules/text/js/forbidden-prettier.mjs` — `export function check()`, використовує `createCheckReporter` та `existsSync`
- Тести: `npm/rules/text/js/tests/forbidden-prettier.test.mjs` — 5 vitest-кейсів
- Видалений блок: `for (const f of ['.prettierrc', ...])` з `formatting.mjs`
- Runner auto-discovery: `scripts/lib/discover-checkable-rules.mjs` підхоплює будь-який `rules/<id>/js/<concern>.mjs`
- E2E: `bun /path/n-cursor.js fix text` у tempdir з `.prettierignore` → exit 1
