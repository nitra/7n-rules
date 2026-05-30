---
session: 81d1c1e1-6258-4aeb-9e51-392ce92fa4f3
captured: 2026-05-30T06:58:05+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/81d1c1e1-6258-4aeb-9e51-392ce92fa4f3.jsonl
---

## ADR Зміна viewer архітектурної документації: Zed + marksman LSP замість MkDocs Material

## Context and Problem Statement
Правило `n-ci4.mdc` рекомендувало MkDocs Material як viewer для документації. Єдиною вимогою до перегляду документів було «зручно редагувати у Zed без необхідності запускати dev-сервер».

## Considered Options
* MkDocs Material (`mkdocs serve`)
* VitePress (`bun dev`)
* Starlight (Astro)
* Docusaurus
* Antora (AsciiDoc)
* **Zed built-in MD preview + `marksman` LSP** (без site-generator-а)

## Decision Outcome
Chosen option: "Zed built-in MD preview + `marksman` LSP без site-generator-а", because єдина висловлена вимога — file-by-file перегляд у Zed без запуску будь-яких процесів; Zed рендерить CommonMark/GFM/Mermaid з коробки, marksman дає `[[wiki-link]]`-навігацію, `cmd+click`, outline і backlinks.

### Consequences
* Good, because transcript фіксує очікувану користь: нуль запущених процесів, MD preview актуальний у Zed, marksman-LSP резолвить `[[slug]]` через file-stem, перехресна навігація `docs/` і `README.md` в одному workspace.
* Bad, because framework-specific синтаксис (`!!! note`, `=== "tab"`, `::: tip`) не рендериться у Zed preview — тому введено жорсткий portable subset; сторінки, що раніше використовували pymdownx-розширення Material, потребують конвертації.

## More Information
Змінено у `npm/rules/ci4/ci4.mdc` v2.1 → v3.0 (bump `npm` 1.29.1 → 1.30.0). Секцію `## MkDocs Material: collapsible engineer-блоки` замінено на `## Viewer/editor: Zed + marksman LSP`. Мирор `.cursor/rules/n-ci4.mdc` пересинкнено через `npx @nitra/cursor`.

---

## ADR Portable-синтаксис для collapsible-блоків: HTML5 `<details>` замість pymdownx `??? engineer`

## Context and Problem Statement
Архітектурна документація обслуговує змішану аудиторію (менеджери + інженери). Попередній підхід — pymdownx `??? engineer / ??? ops` — не рендерився у Zed і порушував вимогу file-by-file перегляду без сервера.

## Considered Options
* pymdownx `??? engineer` (MkDocs Material-specific)
* VitePress `::: details`
* HTML5 `<details><summary>` (CommonMark-сумісний)

## Decision Outcome
Chosen option: "HTML5 `<details><summary>`", because це єдиний collapsible-синтаксис, що рендериться у Zed built-in MD preview, виживає в будь-якому CommonMark-renderer-і і зберігає portable subset.

### Consequences
* Good, because transcript фіксує очікувану користь: Zed рендерить `<details>` нативно; конфіг збирача замінний без переписування контенту.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Конвенція `<summary>`: перше слово — аудиторія з фіксованого словника (`Engineer:` / `Ops:` / `Security:` / `Manager:`). Введено у `npm/rules/ci4/ci4.mdc` v3.0. Відповідний промпт-скелет LLM-проекцій оновлено під новий синтаксис. Заборонено: pymdownx, VitePress containers, MDX-компоненти, Hugo shortcodes, AsciiDoc.

---

## ADR Конфіг `.marksman.toml`: wiki.style = file-stem, glfm, toc

## Context and Problem Statement
Marksman LSP потребує `.marksman.toml` у корені workspace для правильного резолву посилань. Без явного конфігу резолв wiki-link-ів і GFM-фічі залежать від дефолтів, які можуть не збігатися з конвенцією ADR-slug.

## Considered Options
* `wiki.style = "file-stem"` (стабільний ідентифікатор = ім'я файлу)
* `wiki.style = "title-slug"` (slug з H1-заголовку)
* Без `.marksman.toml` (дефолти marksman)

## Decision Outcome
Chosen option: "`wiki.style = "file-stem"` + `markdown.glfm = true` + `code_action.toc.enable = true`", because ADR-slug (`oidc-pkce-flow`) використовується як стабільний ідентифікатор у `sources="..."`, manifest і валідаторі — він не ламається при зміні H1-заголовку; GFM потрібен для alerts `> [!NOTE]` і task-lists нашого portable subset; TOC корисний для довгих arc42-сторінок.

### Consequences
* Good, because transcript фіксує очікувану користь: `cmd+click` по `[[oidc-pkce-flow]]` стрибає у файл, автокомпліт пропонує slug, не title; `Insert TOC` code action доступна в Zed.
* Bad, because `docs/adr/YYYYMMDD-HHMMSS-<sid>.md` (drafts) потрапляють в автокомпліт як шумні `[[20260530-103200-...]]`; transcript обирає варіант «не чіпати» (option 1).

## More Information
Canonical baseline: `npm/rules/ci4/js/data/marksman_config/marksman.baseline.toml`. Три активні опції: `[core] markdown.glfm = true`, `[completion] wiki.style = "file-stem"`, `[code_action] toc.enable = true`. `markdown.file_extensions` не розширено на `.mdc` — операційні правила не є частиною docs-workspace.

---

## ADR Авто-створення `.marksman.toml` через JS-концерн, а не policy

## Context and Problem Statement
Потрібно автоматично розміщати `.marksman.toml` при запуску `npx @nitra/cursor fix ci4`. В системі є два механізми: rego policy (валідація) і JS-концерн (`*.mjs` у `rules/<id>/js/`).

## Considered Options
* Rego policy з `deny` коли файл відсутній (тільки репортинг, без автостворення)
* JS-концерн `marksman_config.mjs` за паттерном `test.stryker_config`

## Decision Outcome
Chosen option: "JS-концерн `marksman_config.mjs`", because rego policy не може писати файли — лише репортити порушення; JS-концерн через `ensureBaselineFile` копіює canonical baseline і є ідемпотентним (не перетирає ручні правки).

### Consequences
* Good, because transcript фіксує очікувану користь: `fix ci4` створює `.marksman.toml` при першому прогоні і повертає `✅ .marksman.toml існує` при повторних; 4/4 тести PASS.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/rules/ci4/js/marksman_config.mjs`, `npm/rules/ci4/js/data/marksman_config/marksman.baseline.toml`, `npm/rules/ci4/js/tests/marksman_config.test.mjs` (4 сценарії через `withTmpDir`). Bump `npm` 1.31.0 → 1.32.0. `fix changelog` ✅ / `fix ci4` ✅.

---

## ADR Вимога VSCode-розширення `arr.marksman` через rego policy в ci4

## Context and Problem Statement
Перехід viewer-а на marksman LSP означає, що розробники, які використовують VSCode, потребують розширення `arr.marksman`. Без policy це розширення не буде присутнє у `.vscode/extensions.json` репозиторіїв, що застосовують `ci4.mdc`.

## Considered Options
* Згадати у `.mdc` як текстову рекомендацію (без enforcement)
* Rego policy `vscode_extensions` за паттерном `text`, `style-lint`, `ga`

## Decision Outcome
Chosen option: "Rego policy `vscode_extensions`", because інші правила пакета вже використовують цей паттерн для enforcement VSCode-розширень; policy автоматично репортить відсутність рекомендації при `fix ci4`.

### Consequences
* Good, because transcript фіксує очікувану користь: `fix ci4` детектує відсутній `arr.marksman` і репортить `❌`; після додавання у `.vscode/extensions.json` — `✅ vscode_extensions: 1 файл(ів) OK`; rego unit tests 5/5 PASS.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/rules/ci4/policy/vscode_extensions/vscode_extensions.rego` (package `ci4.vscode_extensions`), `vscode_extensions_test.rego`, `template/extensions.json.snippet.json` (`{"recommendations": ["arr.marksman"]}`), `target.json` (single `.vscode/extensions.json`). До `.vscode/extensions.json` самого репо додано `arr.marksman`. Bump `npm` 1.30.0 → 1.31.0.
