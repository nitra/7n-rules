---
session: 4a6350d4-09fc-48ad-b274-e81cf19e7e26
captured: 2026-05-17T16:06:26+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/4a6350d4-09fc-48ad-b274-e81cf19e7e26.jsonl
---

## ADR Markdown-лінки до `template/` у `.mdc`-файлах стають недійсними після sync до `.cursor/rules/`

## Context and Problem Statement
В рамках плану `2026-05-17-template-dir-phase-0-1.md` (Task 14) в `npm/rules/security/security.mdc` було замінено inline canon-блоки на markdown-лінки вигляду `[package.json.deny.json](./policy/package_json/template/package.json.deny.json)`. CLI (`npm/bin/n-cursor.js`) копіює `.mdc`-файли до `.cursor/rules/` (з перейменуванням `nitra-*.mdc` → `n-*.mdc`), але не копіює поруч `template/`-каталоги. Відносні лінки, що діяли у `npm/rules/security/`, стають недійсними у `.cursor/rules/n-security.mdc`.

## Considered Options
* Markdown-лінки у `.mdc` до `./policy/.../template/` (обраний у Task 14)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Markdown-лінки у `.mdc` до `./policy/.../template/`", because план (Task 14) передбачав заміну inline-блоків посиланнями на файли `template/` для того, щоб `security.mdc` слугував живою документацією з посиланнями на машиночитаний канон.

### Consequences
* Good, because `npm/rules/security/security.mdc` у своєму source-репо (cursor) містить живі, клікабельні посилання на файли `template/`.
* Bad, because після sync до `.cursor/rules/n-security.mdc` лінки вигляду `./policy/package_json/template/package.json.deny.json` є недійсними — `template/`-каталоги не переносяться поруч із `.mdc`-файлом, тому Cursor IDE та інші споживачі синхронізованого файлу не можуть перейти за посиланням.

## More Information
- Файли зачеплені: `npm/rules/security/security.mdc`, `.cursor/rules/n-security.mdc`
- Механізм sync: `npm/bin/n-cursor.js` (коментар у рядку ~23, ~30 про `.cursor/rules`)
- Commit, що додав лінки: `6cb91cd docs(security): replace inline canon blocks with markdown refs to template/`
- `template/`-файли живуть у `npm/rules/security/policy/package_json/template/` та `npm/rules/security/fix/gitleaks/template/`; до `.cursor/rules/` вони не копіюються (підтверджено `find /Users/vitaliytv/www/nitra/cursor/.cursor` — жодного `*.snippet.*` / `*.deny.*` / `*.contains.*` файлу там немає)
