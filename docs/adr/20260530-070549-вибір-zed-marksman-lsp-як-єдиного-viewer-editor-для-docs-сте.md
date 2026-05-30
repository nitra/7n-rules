---
session: 81d1c1e1-6258-4aeb-9e51-392ce92fa4f3
captured: 2026-05-30T07:05:49+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/81d1c1e1-6258-4aeb-9e51-392ce92fa4f3.jsonl
---

---

## ADR Вибір Zed + marksman LSP як єдиного viewer/editor для docs-стеку

## Context and Problem Statement

Команда визначала, який інструмент використовувати для перегляду та редагування архітектурної документації (arc42 + Diátaxis + ADR) без запуску site-генератора. Попереднє правило `n-ci4.mdc` рекомендувало MkDocs Material як viewer і pymdownx-admonitions для collapsible-блоків — але ці розширення не рендеряться у вбудованому MD-preview Zed без запущеного `mkdocs serve`.

## Considered Options

* Zed built-in MD-preview + marksman LSP (без site-генератора)
* MkDocs Material з `mkdocs serve`
* VitePress з `bun dev`
* Docusaurus / Starlight / Antora

## Decision Outcome

Chosen option: "Zed built-in MD-preview + marksman LSP", because користувач явно обрав режим «хочу прям пофайлово ходити і дивитись» без необхідності окремо запускати будь-який сервер.

### Consequences

* Good, because правило `n-ci4.mdc` оновлено до v3.x: видалено `mkdocs.yml`, pymdownx та `??? engineer`-синтаксис; введено portable-only subset (CommonMark + GFM + Mermaid + KaTeX + нативний HTML5 `<details>`), сумісний із Zed-preview.
* Bad, because framework-specific admonitions (`!!! note`, `::: tip`) тепер заборонені в docs/ — контрибʼютори що звикли до Material/VitePress мають дотримуватись обмеженого синтаксису.

## More Information

- `npm/rules/ci4/ci4.mdc` — оновлено з v2.1 до v3.2; секція «Viewer/editor: Zed + marksman LSP» визначає portable-only subset і інструменти.
- `npm/rules/ci4/policy/vscode_extensions/template/extensions.json.snippet.json` — рекомендація `arr.marksman` для VSCode-альтернативи.
- `.vscode/extensions.json` — додано `arr.marksman`.
- `.marksman.toml` — автоматично генерується концерном `marksman_config.mjs` при `npx @nitra/cursor fix ci4`; три ключових налаштування: `markdown.glfm = true`, `wiki.style = "file-stem"`, `toc.enable = true`.
- Поточний `.gitignore` вже виключає `node_modules/`, `dist/`, `**/reports/stryker/`, `.stryker-tmp/` — marksman через Rust `ignore`-крейт їх не індексує.
- `npm/package.json`: `1.29.1 → 1.32.0`; три записи у `npm/CHANGELOG.md` для `[1.30.0]`, `[1.31.0]`, `[1.32.0]`.
