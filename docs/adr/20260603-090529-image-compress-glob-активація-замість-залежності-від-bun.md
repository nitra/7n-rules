---
session: 2b3e2d11-3e3a-4556-ad25-e5787c1d45f0
captured: 2026-06-03T09:05:29+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/2b3e2d11-3e3a-4556-ad25-e5787c1d45f0/2b3e2d11-3e3a-4556-ad25-e5787c1d45f0.jsonl
---

---

## ADR image-compress: glob-активація замість залежності від bun

## Context and Problem Statement
Правило `image-compress` автоматично додавалось у `.n-cursor.json` будь-якого bun-репозиторію через Type C залежність (`{ "auto": ["bun"] }`), навіть якщо в проєкті взагалі відсутні растрові або SVG-файли. Потрібно обмежити авто-активацію лише тими репозиторіями, де реально є такі файли.

## Considered Options
* Залишити Type C (`"auto": ["bun"]`) — поточний стан
* Переключити на glob-активацію (`"auto": { "glob": "**/*.{png,jpg,jpeg,gif,svg}" }`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Переключити на glob-активацію", because glob-форма є семантично точною: `image-compress` потрібен лише тоді, коли в репо справді є зображення, а не лише через наявність `bun`. Значення glob взято дослівно з context-glob у `image-compress.mdc` (`**/*.{png,jpg,jpeg,gif,svg}`), що дає єдине джерело істини.

### Consequences
* Good, because bun-проєкт без растрів/SVG більше не отримує `image-compress` в `.n-cursor.json`.
* Good, because glob-значення в `meta.json` та `.mdc` frontmatter тепер ідентичні — знижується ризик розсинхронізації.
* Bad, because `globToRegex` не підтримував brace-розкриття `{a,b,c}`, тому зміна `meta.json` вимагала додаткового патчу функції `globToRegex` у `npm/rules/npm-module/js/package_structure.mjs` (brace-символи раніше екранувались як літерали).

## More Information
- `npm/rules/image-compress/meta.json` — змінено з `{ "auto": ["bun"] }` на `{ "auto": { "glob": "**/*.{png,jpg,jpeg,gif,svg}" } }`
- `npm/rules/npm-module/js/package_structure.mjs` (`globToRegex`) — додано підтримку brace-альтернатив: `{a,b,c}` перетворюється на `(?:a|b|c)` у регулярному виразі
- `npm/rules/image-avif/meta.json` — єдиний споживач `image-compress` як залежності (`{ "auto": ["vue", "image-compress"] }`); збережено без змін, бо `image-avif` семантично потребує растрів
- `npm/scripts/tests/auto-rules.test.mjs` — видалено тест co-activation `image-compress` + `bun`; додано тести: bun без зображень → відсутній, bun з `.png` → присутній, `.png` без vue → лише `image-compress`
- `npm/rules/npm-module/js/tests/pure-helpers.test.mjs` — новий тест brace-розкриття в suite `globToRegex`
- Change-файл: `npm/.changes/1780466581847-9b5f19.md` (`bump: minor`, `section: Changed`)
- Команда запуску тестів: `bunx vitest run` (2303 passed)
