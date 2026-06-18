---
type: ADR
title: "image-compress: glob-активація замість залежності від bun"
---

# image-compress: glob-активація замість залежності від bun

**Status:** Accepted
**Date:** 2026-06-03

## Context and Problem Statement
Правило `image-compress` автоматично додавалось у `.n-cursor.json` будь-якого bun-репозиторію через Type C залежність (`{ "auto": ["bun"] }`), навіть якщо в проєкті відсутні растрові або SVG-файли. Паралельно виявилось, що `globToRegex` у `package_structure.mjs` не підтримував brace-розкриття `{a,b,c}`: символи `{`, `}`, `,` екранувались як regex-літерали, тому glob-матчинг для таких патернів фактично не спрацьовував.

## Considered Options
- Залишити Type C (`"auto": ["bun"]`) — поточний стан
- Переключити на glob-активацію (`"auto": { "glob": "**/*.{png,jpg,jpeg,gif,svg}" }`)
- Зберігати масив окремих патернів у `meta.json` замість brace-форми (обхідний шлях без виправлення `globToRegex`)
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Переключити на glob-активацію + підтримка brace-альтернатив у `globToRegex`", because glob-форма є семантично точною: `image-compress` потрібен лише тоді, коли в репо справді є зображення, а не через наявність `bun`. Значення glob взято дослівно з context-glob у `image-compress.mdc` — єдине джерело істини. Brace-форма в `meta.json` вимагала виправлення `globToRegex`, оскільки попередня реалізація навмисно уникала braces і використовувала масив патернів як обхідний шлях, що не задовольняло вимогу синхронізації з `.mdc`.

### Consequences
- Good, because bun-проєкт без растрів/SVG більше не отримує `image-compress` в `.n-cursor.json` автоматично.
- Good, because glob-значення в `meta.json` та `.mdc` frontmatter тепер ідентичні — знижується ризик розсинхронізації.
- Bad, because зміна `meta.json` на brace-форму вимагала додаткового патчу `globToRegex` у `package_structure.mjs`; рефакторинг `if/else if` → `switch` із фігурними дужками в `case` необхідний через вимоги oxc-лінтера.

## More Information
- `npm/rules/image-compress/meta.json` — змінено з `{ "auto": ["bun"] }` на `{ "auto": { "glob": "**/*.{png,jpg,jpeg,gif,svg}" } }`.
- `npm/rules/npm-module/js/package_structure.mjs` (`globToRegex`) — підтримка brace-альтернатив: `{` відкриває `(?:`, `}` закриває `)`, `,` всередині brace-блоку додає `|`; рефакторено з `if/else if` на `switch` із фігурними дужками у `case`; попередня реалізація навмисно уникала braces і використовувала масив патернів як обхідний шлях.
- `npm/rules/image-avif/meta.json` — єдиний споживач `image-compress` як залежності (`{ "auto": ["vue", "image-compress"] }`); збережено без змін, бо `image-avif` семантично потребує растрів.
- `npm/scripts/tests/auto-rules.test.mjs` — видалено тест co-activation `image-compress + bun`; додано кейси: bun без зображень → відсутній, bun з `.png` → присутній, `.png` без vue → лише `image-compress`.
- `npm/rules/npm-module/js/tests/pure-helpers.test.mjs` — тест brace-розкриття: `globToRegex('**/*.{png,jpg,svg}')`.
- `npm/.changes/1780466581847-9b5f19.md` — change-файл `bump: minor`, `section: Changed`.
- Команда: `bunx vitest run` — 2303 passed, 2 skipped.
