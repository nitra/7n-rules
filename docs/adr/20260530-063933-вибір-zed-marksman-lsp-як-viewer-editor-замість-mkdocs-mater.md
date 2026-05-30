---
session: 81d1c1e1-6258-4aeb-9e51-392ce92fa4f3
captured: 2026-05-30T06:39:33+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/81d1c1e1-6258-4aeb-9e51-392ce92fa4f3.jsonl
---

## ADR Вибір Zed + marksman LSP як viewer/editor замість MkDocs Material

## Context and Problem Statement
Правило `n-ci4.mdc` рекомендувало **MkDocs Material** (`mkdocs serve`) як viewer для архітектурної документації. Користувач сформулював єдину вимогу: переглядати docs файл-за-файлом у **Zed** без запуску dev-сервера.

## Considered Options
* MkDocs Material (`mkdocs serve`)
* VitePress (`bun dev`, Vite HMR)
* Docusaurus / Starlight (Astro)
* Antora (AsciiDoc)
* Hugo + Docsy
* Sphinx + RST/MyST
* Zed built-in MD preview + marksman LSP (без site-generator)

## Decision Outcome
Chosen option: "Zed built-in MD preview + marksman LSP", because це єдиний варіант, що задовольняє вимогу «переглядати файл-за-файлом без запуску сервера»: Zed `cmd+shift+m` рендерить CommonMark/GFM/Mermaid без site-generator; marksman LSP дає навігацію по `[[wiki-links]]`, outline і backlinks.

### Consequences
* Good, because transcript фіксує очікувану користь: file-by-file перегляд без `mkdocs serve` або `bun dev`; Mermaid-діаграми рендеряться вбудовано; forward-compatible — site-generator можна підключити пізніше без переписування контенту.
* Bad, because framework-specific синтаксис (pymdownx admonitions, VitePress containers, MDX, Hugo shortcodes) більше не рендериться у preview — введено portable-only subset: CommonMark + GFM + Mermaid + KaTeX + HTML5 `<details>`.

## More Information
Змінено: `npm/rules/ci4/ci4.mdc` (v2.1 → v3.1); `.cursor/rules/n-ci4.mdc` пересинкнено через `npx @nitra/cursor`. Viewer/editor-секція правила: Zed built-in MD preview + marksman LSP; site-generator позначено «не використовується». VSCode-альтернатива описана в тому ж правилі з розширенням `arr.marksman`.

---

## ADR Заміна `??? engineer` (pymdownx) на HTML5 `<details>` як portable collapsible-блоки

## Context and Problem Statement
Правило `n-ci4.mdc` використовувало `??? engineer` / `??? ops` (pymdownx `details` extension MkDocs Material) для розділення аудиторій менеджер/інженер в одному документі. Після відмови від MkDocs Material цей синтаксис відображається як сирий текст у Zed built-in preview.

## Considered Options
* pymdownx `??? engineer` / `??? ops` (MkDocs Material)
* Нативний HTML5 `<details><summary>` (portable)

## Decision Outcome
Chosen option: "Нативний HTML5 `<details><summary>`", because він входить до portable-only subset і рендериться у CommonMark-preview Zed, GitHub та будь-якому MD-viewer без залежності від збирача.

### Consequences
* Good, because transcript фіксує очікувану користь: forward-compatible — MkDocs/VitePress/Antora можна підключити пізніше без переписування контенту.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Конвенція `<summary>`: перше слово — аудиторія з фіксованого словника (`Engineer:` / `Ops:` / `Security:` / `Manager:`). Заборонені синтаксиси перераховані у `npm/rules/ci4/ci4.mdc` у списку «Заборонено». Промпт-скелет LLM-проекцій у тому ж файлі оновлено під `<details>`. Конвенція про порожні рядки навколо `<details>` закріплена у валідаторній секції правила.

---

## ADR Rego-policy для VSCode-розширення arr.marksman у правилі ci4

## Context and Problem Statement
Правило `n-ci4.mdc` після переходу на marksman LSP повинно вимагати відповідне VSCode-розширення (`arr.marksman`) у `.vscode/extensions.json` — за аналогією з іншими правилами пакета `@nitra/cursor` (text, style-lint, rego тощо), де кожне правило постачає `policy/vscode_extensions/*.rego`.

## Considered Options
* Додати `arr.marksman` лише в `.mdc`-описі без машинної перевірки
* Створити `policy/vscode_extensions/` за існуючим патерном (rego + test + snippet + target)

## Decision Outcome
Chosen option: "Створити `policy/vscode_extensions/` за існуючим патерном", because цей патерн уже застосований у щонайменше шести інших правилах пакета і забезпечує machine-enforced перевірку через `npx @nitra/cursor fix ci4` замість просто рекомендації в тексті.

### Consequences
* Good, because transcript фіксує: `npx @nitra/cursor fix ci4` виявляє відсутній `arr.marksman` і після додавання повертає ✅; `opa test` — 5/5 PASS.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Створено: `npm/rules/ci4/policy/vscode_extensions/vscode_extensions.rego` (package `ci4.vscode_extensions`), `vscode_extensions_test.rego` (5 тестів), `template/extensions.json.snippet.json` (`{"recommendations": ["arr.marksman"]}`), `target.json` (single `.vscode/extensions.json`). Додано `arr.marksman` у `.vscode/extensions.json` проєкту. `npm/package.json`: `1.30.1 → 1.31.0`; `npm/CHANGELOG.md`: запис `[1.31.0] - 2026-05-30`.
