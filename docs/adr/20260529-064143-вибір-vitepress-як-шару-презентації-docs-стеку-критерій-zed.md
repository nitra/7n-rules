---
session: 81d1c1e1-6258-4aeb-9e51-392ce92fa4f3
captured: 2026-05-29T06:41:43+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/81d1c1e1-6258-4aeb-9e51-392ce92fa4f3.jsonl
---

## ADR Вибір VitePress як шару презентації docs-стеку (критерій — Zed)

## Context and Problem Statement
Команда розглядала повний docs-стек (arc42 + Diátaxis + AUTOGEN + MkDocs Material) і поставила питання: яку із презентаційних альтернатив обрати, якщо єдиною вимогою є зручна робота в редакторі Zed?

## Considered Options
* VitePress (Markdown + Vue + TS, Vite HMR)
* Starlight / Astro (MDX + Vite HMR)
* MkDocs Material (Markdown, pymdownx-розширення)
* Docusaurus (MDX, React, Node)
* Antora (AsciiDoc, мультирепо)
* Sphinx / Furo (RST або MyST)
* Hugo + Docsy (Markdown + Go-templates)
* Nextra (MDX, Next.js)

## Decision Outcome
Chosen option: "VitePress", because усі формати, які редагуються в docs (Markdown, Vue SFC, TypeScript), є рідними для Zed (офіційні розширення + Tree-sitter); Vite HMR у Zed-терміналі дає найшвидший цикл «правка → браузер»; конфіг `.vitepress/config.ts` отримує автокомпліт через LSP без додаткових налаштувань.

### Consequences
* Good, because transcript фіксує очікувану користь: жодних додаткових Zed-розширень не потрібно; Vue + TS + MD-редагування — першокласний DX у Zed.
* Bad, because AUTOGEN-інтеграції (OpenAPI/GraphQL/ADR-index) не мають готових плагінів — їх треба писати як `bun`-скрипти, що генерують Markdown у `docs/`.

## More Information
Альтернативи, що програли за критерієм Zed:
- `Antora` — AsciiDoc у Zed без LSP і preview;
- `MkDocs Material` — pymdownx-розширення (`!!! note`, `=== "tab"`) не рендеряться у вбудованому MD-preview;
- `Docusaurus` / `Starlight` — MDX-компоненти невидимі без збірки.

---

## ADR Portable Markdown + Mermaid як синтаксична дисципліна для file-by-file перегляду в Zed

## Context and Problem Statement
Після вибору VitePress користувач уточнив: хочеться переглядати docs пофайлово прямо в Zed без запуску жодного dev-сервера, спираючись на вбудований MD-preview та можливі розширення редактора.

## Considered Options
* Використовувати VitePress-специфічний синтаксис (`::: tip`, `::: details`, custom containers) повноцінно
* Обмежити контент до **portable Markdown + Mermaid** + `marksman` LSP; framework-specific розширення — лише де справді потрібно

## Decision Outcome
Chosen option: "Portable Markdown + Mermaid + marksman LSP", because вбудований MD-preview Zed рендерить CommonMark + GFM + Mermaid без жодного сервера; будь-який framework-specific синтаксис (VitePress-контейнери, Material-admonitions, MDX-компоненти) відображається лише як сирий текст — file-by-file DX зламаний.

### Consequences
* Good, because transcript фіксує очікувану користь: `marksman` LSP дає `cmd+click` по `[link](file.md)` і `[[wiki-link]]`, автокомпліт заголовків, find-references, перейменування з оновленням посилань — Obsidian-vault experience поверх `docs/`.
* Bad, because framework-specific admonitions/tabs, які покращують UX публікованого сайту, доветься або уникати, або замінювати на компроміс (`> **Note**`-цитати), або сегрегувати в окремі reference-сторінки де preview вторинне.

## More Information
Конфігурація Zed:
```json
{ "languages": { "Markdown": { "language_servers": ["marksman"] } } }
```
Таблиця рендерингу у вбудованому preview (з transcript): CommonMark + GFM — ✅, Mermaid fenced-block — ✅, frontmatter YAML — ✅ (ховається), VitePress `:::` containers — ❌, MDX-компоненти — ❌, AsciiDoc include/admonitions — ❌.
AUTOGEN-сторінки (OpenAPI/GraphQL/ADR-index) генеруються як plain Markdown — у Zed виглядають як звичайні файли.
