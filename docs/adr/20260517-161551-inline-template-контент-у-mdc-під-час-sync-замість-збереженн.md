---
session: 4a6350d4-09fc-48ad-b274-e81cf19e7e26
captured: 2026-05-17T16:15:51+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/4a6350d4-09fc-48ad-b274-e81cf19e7e26.jsonl
---

## ADR Inline template-контент у .mdc під час sync замість збереження markdown-лінків

## Context and Problem Statement
Після впровадження Phase 0+1 `template/` інфраструктури (`npm/rules/security/security.mdc`) з'явилися markdown-лінки виду `[package.json.deny.json](./policy/package_json/template/package.json.deny.json)`. Коли CLI (`n-cursor`) копіює лише плаский `<id>.mdc` у `.cursor/rules/n-security.mdc` без відповідних `template/` директорій, ці лінки стають недійсними для проєкту-споживача.

## Considered Options
* Inline-підстановка вмісту `template/<file>` у fenced-блок під час `n-cursor sync` (замість лінка)
* Замінити лінки на абсолютні GitHub-URL
* Копіювати `template/` у `.cursor/rules-data/<id>/...` і переписувати лінки під час sync

## Decision Outcome
Chosen option: "Inline-підстановка вмісту `template/<file>` у fenced-блок під час `n-cursor sync`", because це зберігає `.mdc` self-contained для споживача (аналогічно до поточного стану без `template/`), усуває залежність від інтернету та версійний дрейф, і не вимагає розміщення додаткових директорій у `.cursor/`.

### Consequences
* Good, because `.cursor/rules/n-security.mdc` залишається єдиним self-contained файлом для споживача — без зовнішніх залежностей у `.cursor/`.
* Good, because transcript фіксує очікувану користь: один source of truth (`npm/rules/<id>/template/`), споживач читає весь канон з одного місця.
* Bad, because потрібен парсер markdown-лінків у sync-пайплайні (`npm/bin/n-cursor.js`), що ускладнює логіку копіювання.

## More Information
- Лінки у вихідному файлі: `npm/rules/security/security.mdc` (після commit `6cb91cd`)
- Цільовий файл після sync: `.cursor/rules/n-security.mdc`
- Sync-логіка: `npm/bin/n-cursor.js` (рядки ~23–30, ~397–406)
- `template/` файли, що потребують inline: `npm/rules/security/policy/package_json/template/package.json.{snippet,deny,contains}.json`, `npm/rules/security/fix/gitleaks/template/.gitleaks.toml.snippet.toml`
- Рішення прийнято в цій сесії; реалізація CLI-парсера ще не виконана.
