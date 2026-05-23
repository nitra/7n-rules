---
session: ad2778ec-2972-4dc6-84de-95c0327ff501
captured: 2026-05-23T22:42:57+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/ad2778ec-2972-4dc6-84de-95c0327ff501.jsonl
---

## ADR Розмежування внутрішніх `check-<rule>.mjs` та CLI-команди `fix`

## Context and Problem Statement
Після коміту `68b3f6f` (`feat(cli): rename check → fix + spawn-wrapper до rules/<id>/fix.mjs`) у кодовій базі залишилися численні посилання на слово `check`. Виникло питання: які з них треба замінити на `fix`, а які — залишити, бо вони посилаються на внутрішні lint-скрипти, а не на перейменовану CLI-команду.

## Considered Options
* Замінити **всі** згадки `check` → `fix` скрізь
* Розмежувати: зовнішні посилання на CLI-команду оновити, внутрішні `check-<rule>.mjs`-скрипти — залишити під `check`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Розмежувати зовнішні CLI-посилання та внутрішні `check-<rule>.mjs`", because `conftest.mdc` явно описує `check-<rule>.mjs` як внутрішній детерміністичний крок усередині `lint-<rule>.mjs` («викликає `check()` з `check-<rule>.mjs` як фінальний крок»), — це самостійна концепція, не пов'язана з назвою публічної CLI-команди.

### Consequences
* Good, because внутрішні скрипти на кшталт `npm/rules/image-compress/js/package_setup/check.mjs` або `check-<rule>.mjs` не потребують перейменування й залишаються несуперечливими з `conftest.mdc`.
* Bad, because у файлах `npm/bin/n-cursor.js` (JSDoc-коментар `npx @nitra/cursor check`), `.claude/settings.json` (permission `Bash(npx @nitra/cursor check)`), `npm/scripts/claude-stop-hook.mjs` та `.claude/commands/n-check.md` залишаються застарілі посилання на стару CLI-назву `check`, які потребують окремого оновлення.

## More Information
Файли з живими зовнішніми посиланнями на стару CLI-команду, виявленими під час сесії:
- `npm/bin/n-cursor.js` — JSDoc згадує `npx @nitra/cursor check`
- `npm/scripts/claude-stop-hook.mjs` — рядок `npx @nitra/cursor check` у коментарі
- `.claude/settings.json` — permission entry `"Bash(npx @nitra/cursor check)"`
- `.claude/commands/n-check.md` — команда `n-check` посилається на стару `check`

Файли з внутрішніми `check-*` посиланнями, які **не** потребують заміни:
- `npm/rules/*/js/*/check.mjs` — внутрішні перевірочні скрипти
- `.cursor/rules/conftest.mdc` — визначає роль `check-<rule>.mjs` у ланцюгу `lint-<rule>.mjs`

Прийнятий план: `git log 68b3f6f`.
