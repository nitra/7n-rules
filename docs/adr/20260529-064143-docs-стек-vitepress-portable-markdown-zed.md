---
type: ADR
title: "Docs-стек: VitePress і Portable Markdown для перегляду в Zed"
---

# Docs-стек: VitePress і Portable Markdown для перегляду в Zed

**Status:** Accepted
**Date:** 2026-05-29

## Context and Problem Statement

Команда обирала презентаційний шар і синтаксичну дисципліну для `docs/`. Єдина вимога: зручна робота у редакторі Zed — file-by-file перегляд без dev-сервера.

## Considered Options

- VitePress (Markdown + Vue + TS, Vite HMR)
- Starlight / Astro (MDX + Vite HMR)
- MkDocs Material (Markdown, pymdownx)
- Docusaurus (MDX, React, Node)
- Antora (AsciiDoc, мультирепо)
- Sphinx / Furo (RST або MyST)
- Hugo + Docsy (Markdown + Go-templates)
- Nextra (MDX, Next.js)
- Синтаксис: portable Markdown + Mermaid + marksman LSP vs повний VitePress-специфічний синтаксис

## Decision Outcome

Chosen option: "VitePress + Portable Markdown + Mermaid + marksman LSP", because VitePress: Markdown/Vue SFC/TypeScript — рідні для Zed (офіційні розширення + Tree-sitter); Vite HMR у Zed-терміналі найшвидший цикл; `.vitepress/config.ts` — автокомпліт через LSP. Portable Markdown: вбудований MD-preview Zed рендерить CommonMark + GFM + Mermaid без сервера; framework-specific синтаксис відображається як сирий текст і зламує file-by-file DX.

### Consequences

* Good, because жодних додаткових Zed-розширень не потрібно; Vue + TS + MD — першокласний DX.
* Good, because `marksman` LSP: `cmd+click` по посиланнях, автокомпліт заголовків, find-references, перейменування.
* Bad, because AUTOGEN-інтеграції (OpenAPI/GraphQL/ADR-index) треба писати як `bun`-скрипти.
* Bad, because framework-specific admonitions/tabs треба уникати або замінювати на `> **Note**` чи `<details>/<summary>`.
* Neutral, because Antora (AsciiDoc без LSP у Zed), MkDocs Material (pymdownx не рендериться), Docusaurus/Starlight (MDX невидимий без збірки) програли за критерієм Zed.

## More Information

Рендеринг у Zed built-in preview: CommonMark + GFM — ✅, Mermaid fenced-block — ✅, frontmatter YAML — ✅, VitePress `:::` — ❌, MDX — ❌, AsciiDoc admonitions — ❌.

`marksman` у `~/.config/zed/settings.json`: `{"languages": {"Markdown": {"language_servers": ["marksman"]}}}`.

Адодаткової інформації про конкретні зміни у файлах у transcript не зафіксовано.

## Update 2026-05-29

### VSCode як альтернативне середовище

Аналогічний DX у VSCode: **Foam + marksman + Markdown Preview Mermaid Support**. Різниця: Zed має Mermaid вбудовано, VSCode потребує розширення.

| Потреба | VSCode | Zed |
|---|---|---|
| Wiki-links + backlinks | Foam або Dendron | marksman |
| Mermaid у preview | Markdown Preview Mermaid Support | вбудовано |
| Admonitions `!!! note` | Markdown Preview Enhanced | ❌ |

Обмеження однакове: framework-specific синтаксис не рендериться без збирача ні в Zed, ні у VSCode.
