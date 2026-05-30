---
session: 81d1c1e1-6258-4aeb-9e51-392ce92fa4f3
captured: 2026-05-30T06:47:32+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/81d1c1e1-6258-4aeb-9e51-392ce92fa4f3.jsonl
---

## ADR Заміна MkDocs Material на Zed + marksman LSP як основний viewer документації

## Context and Problem Statement
Правило `n-ci4.mdc` рекомендувало MkDocs Material як viewer для docs-stack (arc42 + Diátaxis + AUTOGEN). Єдина вимога, яку висловив користувач: зручно переглядати файли без запуску жодного сервера — пофайлово у самому редакторі.

## Considered Options
* Zed built-in MD preview + `marksman` LSP (без site generator)
* MkDocs Material + `mkdocs serve`
* VitePress + `bun dev`
* Starlight (Astro), Docusaurus, Antora, Hugo — обговорені у transcript, відхилені

## Decision Outcome
Chosen option: "Zed built-in MD preview + `marksman` LSP", because єдина вимога («без запуску чогось спеціально») виконується лише цим варіантом: Zed рендерить CommonMark + GFM + Mermaid у fenced code прямо з файлу, a marksman LSP дає `[[wiki-link]]`-навігацію, автокомпліт заголовків і find-references без будь-якого сервера.

### Consequences
* Good, because transcript фіксує очікувану користь: file-by-file перегляд без `mkdocs serve` / `bun dev`; всі формати portable subset (CommonMark + GFM + Mermaid + KaTeX + HTML5 `<details>`) рендеряться у вбудованому preview.
* Bad, because MkDocs Material-специфічні фічі (tabs `=== "…"`, pymdownx admonitions `!!! note`, versioning через mike) повністю виключені зі стека; site generator залишено поза scope правила (позначено як «не використовується»).

## More Information
Змінені файли: `npm/rules/ci4/ci4.mdc` (v2.1 → v3.0 → v3.1), `.cursor/rules/n-ci4.mdc` (пересинкнено). Секція «Viewer/editor: Zed + marksman LSP» замінила «MkDocs Material: collapsible engineer-блоки». Команда sync: `npx @nitra/cursor` (оновлює `.cursor/rules/n-ci4.mdc` з `npm/rules/ci4/ci4.mdc`).

---

## ADR Portable-синтаксис аудиторних блоків — HTML5 `<details>` замість pymdownx `??? engineer`

## Context and Problem Statement
Правило `n-ci4.mdc` використовувало pymdownx `??? engineer` / `??? ops` для collapsible-блоків «менеджер бачить прозу, інженер клікає й провалюється глибше». Після переходу на Zed-preview цей синтаксис відображається як сирий текст — pymdownx не входить у CommonMark/GFM.

## Considered Options
* HTML5 `<details><summary>…</summary>…</details>` — рендериться у Zed built-in preview без плагінів
* pymdownx `??? engineer` — вимагає MkDocs Material + pymdownx.details

## Decision Outcome
Chosen option: "HTML5 `<details><summary>…</summary>…</details>`", because це єдиний collapsible-синтаксис, що є частиною portable subset і рендериться без жодного site generator у Zed preview.

### Consequences
* Good, because transcript фіксує очікувану користь: той самий документ обслуговує дві аудиторії без дублювання; конвенція `<summary>` фіксує перше слово як аудиторію з дозволеного словника (`Engineer:` / `Ops:` / `Security:` / `Manager:`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Промпт-скелет LLM-проекцій і валідатор у `npm/rules/ci4/ci4.mdc` оновлені: перевірки `??? engineer` замінені на перевірки `<details>`-обрамлення. Заборонені синтаксиси явно перераховані у правилі: pymdownx admonitions, VitePress `:::` containers, MDX-компоненти, Hugo shortcodes, AsciiDoc.

---

## ADR VSCode-policy `arr.marksman` у правилі ci4

## Context and Problem Statement
Система рекомендованих VSCode-розширень у монорепо контролюється Rego-policy (pattern `policy/vscode_extensions/`) — наявні правила `text`, `style-lint`, `graphql` та ін. Після фіксації `marksman` як основного LSP для навігації docs/ треба забезпечити, що `.vscode/extensions.json` рекомендує відповідне VSCode-розширення.

## Considered Options
* Додати Rego-policy `ci4.vscode_extensions` з template-snippet `arr.marksman`
* Записати рекомендацію лише в текст `.mdc` без машинної перевірки

## Decision Outcome
Chosen option: "Додати Rego-policy `ci4.vscode_extensions` з template-snippet `arr.marksman`", because у всіх інших правилах (text, style-lint, graphql, ga тощо) рекомендовані розширення контролюються через `policy/vscode_extensions/` — відступати від pattern не доцільно.

### Consequences
* Good, because transcript фіксує очікувану користь: `npx @nitra/cursor fix ci4` детермінистично виявляє відсутність `arr.marksman` у `.vscode/extensions.json`; 5/5 rego unit-тестів PASS.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Нові файли: `npm/rules/ci4/policy/vscode_extensions/target.json`, `template/extensions.json.snippet.json`, `vscode_extensions.rego` (package `ci4.vscode_extensions`), `vscode_extensions_test.rego`. Додано `arr.marksman` у `.vscode/extensions.json` репо. Версія пакета: `1.30.x → 1.31.0`. Валідація: `npx @nitra/cursor fix ci4` ✅, `opa test npm/rules/ci4/policy/vscode_extensions/` ✅ (5/5).

---

## ADR Конфігурація `.marksman.toml` — `wiki.style = "file-stem"` і `toc.enable = true`

## Context and Problem Statement
Після встановлення marksman як основного LSP для docs/ у монорепо треба визначити спосіб резолвінгу `[[wiki-link]]`-ів — за ім'ям файлу (`file-stem`) або за slugified H1-заголовком (`title-slug`). Вибір впливає на стабільність посилань у ADR-системі.

## Considered Options
* `wiki.style = "file-stem"` — резолв за іменем файлу без розширення
* `wiki.style = "title-slug"` — резолв за slugified H1-заголовком файлу

## Decision Outcome
Chosen option: "`wiki.style = \"file-stem\"`", because ADR-slug (`oidc-pkce-flow`) використовується як стабільний ідентифікатор у `sources="…"`, `manifest.json` і валідаторі; заголовок ADR може змінюватися при normalize-проході, тоді як ім'я файлу — ні. Послідовність із решти AUTOGEN-автоматики.

### Consequences
* Good, because transcript фіксує очікувану користь: `[[slug]]`-посилання не ламаються при зміні H1-заголовка у `normalize-decisions.sh`; `toc.enable = true` дає code action «Insert/Update TOC» для довгих arc42-сторінок.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Рекомендований мінімальний конфіг (з transcript): `markdown.glfm = true`, `wiki.style = "file-stem"`, `toc.enable = true`. Файл `.marksman.toml` розміщується в корені репо; marksman підхоплює його автоматично без змін у `~/.config/zed/settings.json`. Нова policy для перевірки наявності `.marksman.toml` запланована — відповідна Rego-policy і тестовий coverage мають бути додані до `npm/rules/ci4/policy/`.
