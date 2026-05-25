---
session: 2ce74495-ae37-461c-a696-487f7361df48
captured: 2026-05-25T11:13:16+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/2ce74495-ae37-461c-a696-487f7361df48.jsonl
---

## ADR `docs/adr/**` у канонічному `cspell ignorePaths`

## Context and Problem Statement
ADR-файли в `docs/adr/` генеруються машинно через `capture-decisions.sh` і `normalize-decisions.sh`. Вони містять технічний жаргон, терміни і ідентифікатори, перевірка яких через cspell безглузда і породжує хибні помилки.

## Considered Options
* Додати `docs/adr/**` до канонічного `template/.cspell.json.snippet.json` і rego-правила
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати `docs/adr/**` до канонічного `ignorePaths`", because machine-generated MADR-документи не підлягають перевірці орфографії — це зафіксовано в `text.mdc` v1.30 як пояснення до нового запису.

### Consequences
* Good, because transcript фіксує очікувану користь: rego-тест `test_deny_missing_docs_adr` (8/8 PASS) тепер гарантує наявність шляху в канонічному snippet.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінено: `npm/rules/text/policy/cspell/template/.cspell.json.snippet.json`, `npm/rules/text/policy/cspell/cspell_test.rego` (новий тест `test_deny_missing_docs_adr`), `npm/rules/text/text.mdc` → version `1.30`. Conftest-перевірка: `conftest test --policy npm/rules/text/policy/cspell/cspell.rego --namespace text.cspell --data /tmp/data.json .cspell.json`.

---

## ADR Tooling-only skip у ADR Stop-хуках

## Context and Problem Statement
Сесії, де змінювався лише `.cspell.json` або `package.json#version`, породжували ADR-чернетки через `capture-decisions.sh` і викликали LLM у `normalize-decisions.sh`, хоча дизайн-рішень у таких сесіях немає.

## Considered Options
* Inline bash-функції `is_tooling_only_change` + `git_diff_only_version_field` в обох скриптах (дублювання навмисне)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Inline bash-функції в обох скриптах", because `.claude-template/hooks/` копіюється flat у проєкт-споживач — спільний модуль неможливий без зовнішньої залежності; дублювання навмисне.

### Consequences
* Good, because transcript фіксує очікувану користь: 4/4 інтеграційних тести `capture-decisions-tooling-only.test.mjs` і `normalize-decisions-tooling-only.test.mjs` проходять; `normalize-decisions.sh` видаляє tooling-only чернетку без виклику LLM (перевіряється по `tail .claude/hooks/normalize-decisions.log`).
* Bad, because дублювання коду між `capture-decisions.sh` і `normalize-decisions.sh` потребує синхронного оновлення при зміні логіки.

## More Information
Змінено: `npm/.claude-template/hooks/capture-decisions.sh`, `npm/.claude-template/hooks/normalize-decisions.sh`. Нові тести: `npm/rules/adr/js/tests/capture-decisions-tooling-only.test.mjs`, `npm/rules/adr/js/tests/normalize-decisions-tooling-only.test.mjs`. Документація: `npm/rules/adr/adr.mdc` v2.2, `npm/skills/adr-normalize/SKILL.md`. ENV-змінна `ADR_NORMALIZE_SKIP_TOOLING_ONLY` дозволяє відключити фільтр.

---

## ADR `isRunAsCli(metaUrl)` — параметр замість прямого `import.meta.url`

## Context and Problem Statement
`isRunAsCli()` у `scripts/cli-entry.mjs` і `scripts/lib/run-rule-cli.mjs` порівнювала `import.meta.url` файлу, де функція **визначена**, а не файлу-caller'а. `import.meta` лексично прив'язаний до модуля — у helper-функції він завжди вказував на власний шлях. Через це всі ~40 `if (isRunAsCli())` у `rules/<id>/fix.mjs`, `lint/*.mjs`, `bin/rename-yaml-extensions.mjs` завжди йшли в else-гілку і скрипти мовчки виходили з кодом 0.

## Considered Options
* Параметр `isRunAsCli(import.meta.url)` — caller передає свій `import.meta.url`; консолідація двох дублікатів в один модуль, `run-rule-cli.mjs` робить re-export
* `import.meta.main` — bun-specific, не сумісний з node
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Параметр `isRunAsCli(import.meta.url)` з консолідацією", because user явно обрав «Консолідувати в одну реалізацію + параметр»; `import.meta.main` не підходить через Node.js несумісність.

### Consequences
* Good, because transcript фіксує очікувану користь: `node rules/text/fix.mjs` тепер виводить `🔍 fix text — перевірка правила` і повний звіт; 1044 bun-тести зелені.
* Bad, because ~40 callsites потребували масового `sed`-оновлення; `realpathSync` додає залежність від FS для symlink-нормалізації (macOS `/tmp` ↔ `/private/tmp`).

## More Information
Змінено: `npm/scripts/cli-entry.mjs` (нова сигнатура `isRunAsCli(metaUrl)`), `npm/scripts/lib/run-rule-cli.mjs` (impl видалено, додано `export { isRunAsCli } from '../cli-entry.mjs'`). 40 файлів — `isRunAsCli()` → `isRunAsCli(import.meta.url)` через `sed -i '' 's/if (isRunAsCli())/if (isRunAsCli(import.meta.url))/g'`. Нові тести: `npm/scripts/tests/fixtures/cli-entry-as-cli.mjs` + 3 кейси в `npm/scripts/tests/cli-entry.test.mjs`.

---

## ADR Workflow bundling для запобігання циклу «bump → коміт → нові зміни»

## Context and Problem Statement
Правило `npm-module/js/package_structure.mjs` вимагає, щоб `version` у `npm/package.json` був вищий за HEAD при наявності незакомічених змін під `npm/`. Коли bump комітиться окремо (без контентних змін), наступна правка знову порушує правило — виникає циклічна залежність.

## Considered Options
* Workflow bundling: bump + CHANGELOG завжди в одному коміті з контентними змінами (без зміни коду)
* Дозволити «standalone bump-commit» (зміна правила `package_structure.mjs`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Workflow bundling", because user явно обрав цей варіант; зміна правила збільшила б складність без реальної потреби.

### Consequences
* Good, because transcript фіксує очікувану користь: жодних змін у коді — правило залишається строгим і гарантує, що bump не «губиться».
* Bad, because вимагає дисципліни від розробника: окремий bump-коміт до push потребує `git commit --amend`, що неочевидно за звичного workflow.

## More Information
Якщо bump закомічено окремо до push: `git add -A && git commit --amend --no-edit`. Якщо треба зберегти прогрес без bump: `git stash -u`. Anti-pattern: `git commit -m "1.18.1"` із самим `package.json` + `CHANGELOG.md` — наступна правка на тій самій HEAD-версії знову вимагатиме bump. Додаткової інформації про зміну коду в transcript не зафіксовано.
