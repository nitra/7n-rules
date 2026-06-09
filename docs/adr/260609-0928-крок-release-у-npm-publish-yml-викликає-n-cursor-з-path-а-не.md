---
session: 74bbc0b8-a0c9-4093-b15b-9b1fc730258f
captured: 2026-06-09T09:28:12+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/74bbc0b8-a0c9-4093-b15b-9b1fc730258f.jsonl
---

## ADR Крок Release у `npm-publish.yml` викликає `n-cursor` з PATH, а не `node npm/bin/n-cursor.js`

## Context and Problem Statement

Канонічний сніпет `npm/rules/npm-module/policy/npm_publish_yml/template/npm-publish.yml.snippet.yml` містив команду `node npm/bin/n-cursor.js release`. Downstream-споживачі (зокрема `@7n/n`) отримували `Cannot find module .../npm/bin/n-cursor.js`, бо локальний шлях `npm/bin/n-cursor.js` доступний лише у репо `nitra/cursor`, не у споживача.

## Considered Options

* Викликати бінарник `n-cursor` з PATH
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Викликати бінарник `n-cursor` з PATH", because шлях `npm/bin/n-cursor.js` не існує у downstream-споживачів після встановлення `@nitra/cursor` через npm — бінарник `n-cursor` натомість реєструється у `$PATH` через поле `bin` пакету.

### Consequences

* Good, because transcript фіксує очікувану користь: downstream-споживачі більше не отримують `Cannot find module .../npm/bin/n-cursor.js` під час виконання `npm-publish.yml`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Змінені файли:
- `npm/rules/npm-module/policy/npm_publish_yml/template/npm-publish.yml.snippet.yml` — рядок 40 (джерело правди)
- `.github/workflows/npm-publish.yml` — рядок 40 (власний workflow `nitra/cursor`)
- `npm/rules/npm-module/npm-module.mdc` — рядок 68 (проза правила)
- `.cursor/rules/n-npm-module.mdc` — перегенерований inline-снапшот

Diff у всіх чотирьох файлах однаковий: `-node npm/bin/n-cursor.js release` → `+n-cursor release`.

Conformance-перевірка `npm_module.npm_publish_yml` (engine `check: "template"` через `runTemplateSubsetConcern`) після правок повертає exit code 0.

Change-файл: `npm/.changes/260609-0925.md` (bump: patch, section: Fixed).

---

## ADR Перегенерація inline-снапшота `.cursor/rules/*.mdc` через окремий скрипт, а не через `n-cursor` sync

## Context and Problem Statement

Після правки джерела `npm/rules/npm-module/npm-module.mdc` потрібно оновити inline-снапшот `.cursor/rules/n-npm-module.mdc`. Дефолтний запуск `bun ./npm/bin/n-cursor.js` (sync) виконав self-upgrade до 5.0.0, ADR-нормалізацію, оновлення skills і CLAUDE.md — всі побічні ефекти довелося відкочувати через `git checkout --`.

## Considered Options

* Запустити `n-cursor` sync (дефолт) і прийняти всі побічні ефекти
* Написати мінімальний одноразовий скрипт, що викликає тільки `inlineTemplateLinks` для одного правила

## Decision Outcome

Chosen option: "Написати мінімальний одноразовий скрипт", because дефолтний sync self-upgrades `@nitra/cursor` з реєстру (якщо specifier у кореневому `package.json` — plain semver, не `workspace:`), запускає ADR-нормалізацію і перезаписує skills/CLAUDE.md, що є небажаними side-effects під час точкової правки одного правила.

### Consequences

* Good, because transcript фіксує очікувану користь: diff `.cursor/rules/n-npm-module.mdc` містить рівно два змінені рядки (рядок 68 і рядок 112 snippet), без зайвих змін.
* Bad, because одноразовий скрипт потребує знання внутрішнього API (`inlineTemplateLinks` з `npm/scripts/lib/inline-template-links.mjs`) і не є офіційним інтерфейсом.

## More Information

Одноразовий скрипт `/tmp/regen-npm-module.mjs` викликав:
```js
import { inlineTemplateLinks } from '/Users/vitalii/www/nitra/cursor/npm/scripts/lib/inline-template-links.mjs'
```
Записав результат у `.cursor/rules/n-npm-module.mdc` і видалив себе після виконання.

Причина self-upgrade: функція `upgradeNitraCursorToLatestAndBunInstall` у `npm/bin/n-cursor.js:108` спрацьовує, коли specifier у кореневому `package.json` — plain semver (`^3.22.0`), не `workspace:`/`file:`/`link:`. Тобто `node_modules/@nitra/cursor` у момент sync вказував на published-версію з реєстру, а не на локальний workspace.
