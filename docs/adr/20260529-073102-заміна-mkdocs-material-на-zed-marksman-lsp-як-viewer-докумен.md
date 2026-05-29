---
session: 81d1c1e1-6258-4aeb-9e51-392ce92fa4f3
captured: 2026-05-29T07:31:02+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/81d1c1e1-6258-4aeb-9e51-392ce92fa4f3.jsonl
---

Based on this transcript, here is the ADR:

---

## ADR Заміна MkDocs Material на Zed + marksman LSP як viewer документації

## Context and Problem Statement

Проєкт використовував правило `n-ci4.mdc` (v2.1), що рекомендувало **MkDocs Material** як viewer архітектурної документації з pymdownx-розширеннями (`??? engineer`, `=== "tab"`, admonitions). Користувач висловив єдину вимогу: зручна робота з документацією у редакторі **Zed** без необхідності запускати будь-який site-generator для перегляду файлів.

## Considered Options

* **MkDocs Material** — попередній viewer зі site-generator, pymdownx-синтаксисом і `mkdocs serve`
* **Zed built-in MD-preview + `marksman` LSP** — редактор як viewer, без site-generator, на portable-only Markdown subset

## Decision Outcome

Chosen option: "Zed built-in MD-preview + `marksman` LSP", because єдина вимога — file-by-file перегляд без запуску будь-якого сервера; Zed нативно підтримує CommonMark + GFM + Mermaid, а `marksman` LSP дає wiki-link навігацію та backlinks.

### Consequences

* Good, because transcript фіксує очікувану користь: повний preview кожного `.md`-файлу в Zed без `mkdocs serve` / `vitepress dev`; навігація по `[[]]`/`[](./file.md)`-посиланнях через `marksman`; live-рендер Mermaid-діаграм у built-in preview.
* Bad, because framework-specific синтаксис (`??? engineer`, `=== "tab"`, pymdownx admonitions, VitePress `:::` containers) — заборонений у portable subset; переходити на `<details><summary>` як єдиний механізм collapsible-блоків для змішаної аудиторії (менеджер / інженер).

## More Information

- Змінено `npm/rules/ci4/ci4.mdc` (джерело) і синкнуто в `.cursor/rules/n-ci4.mdc` (мирор)
- Версія пакета `@nitra/cursor`: `1.29.1 → 1.30.0`; запис у `npm/CHANGELOG.md` датований `2026-05-29`
- Permitted portable subset: CommonMark + GFM + Mermaid (fenced) + KaTeX + `<details>/<summary>`
- Заборонені синтаксиси: pymdownx (`!!! note`, `??? engineer`, `=== "tab"`), VitePress containers (`::: tip`), MDX-компоненти, Hugo shortcodes, AsciiDoc include/admonitions
- `<summary>`-конвенція: перше слово — аудиторія з фіксованого словника `Engineer:` / `Ops:` / `Security:` / `Manager:`
- `marksman` LSP прописується у `~/.config/zed/settings.json` як `"language_servers": ["marksman"]` для Markdown
- Валідатор правила отримав 4 нові детерміновані перевірки: тип collapsible-блоку, обрамлюючі порожні рядки, заборонені синтаксиси, marksman-сумісні посилання
- Команда `npx @nitra/cursor fix changelog` підтвердила чистий стан: `✅ CHANGELOG.md: знайдено запис для версії 1.30.`
