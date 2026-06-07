---
session: 998c73ca-c34a-4cc9-9b75-681cc3946b39
captured: 2026-06-07T05:25:22+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/998c73ca-c34a-4cc9-9b75-681cc3946b39.jsonl
---

Готово. CSS тепер використовує стандартні браузерні пропорції (h1: 2em, h2: 1.5em, h3: 1.17em…) — всі заголовки масштабуються відносно 13px base без будь-яких впливів теми чи файлу. Перезавантаж preview (`Cmd+Shift+P` → **Developer: Reload Window**).

---

Тепер — ADR-документ за цим transcript:

---

## ADR Налаштування шрифту markdown preview через custom CSS

## Context and Problem Statement
Стандартне налаштування `markdown.preview.fontSize` у Cursor не давало видимого ефекту — розмір тексту у вікні preview лишався значно більшим за розмір шрифту в інтегрованому терміналі нижче.

## Considered Options
* Налаштування `markdown.preview.fontSize` (вбудований параметр Cursor/VS Code)
* Custom CSS-файл через `markdown.styles` зі стандартними браузерними пропорціями заголовків

## Decision Outcome
Chosen option: "Custom CSS-файл через `markdown.styles`", because `markdown.preview.fontSize` не давав ефекту після `Developer: Reload Window`, а custom CSS підтвердив результат ("краще, але…").

### Consequences
* Good, because transcript фіксує очікувану користь: шрифт preview зменшився до рівня терміналу; заголовки масштабуються пропорційно від 13px base без впливу теми чи front matter файлу.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- CSS-файл: `/Users/vitaliytv/.cursor/markdown-preview.css`
- Підключення: `"markdown.styles": ["/Users/vitaliytv/.cursor/markdown-preview.css"]` у `/Users/vitaliytv/Library/Application Support/Cursor/User/settings.json`
- Також встановлено: `"markdown.preview.fontSize": 11` (лишено як fallback, але фактично не діє)
- Фінальні значення CSS: `body … { font-size: 13px }`, h1: 2em, h2: 1.5em, h3: 1.17em, h4–h6 за браузерним стандартом
