---
session: 4a6350d4-09fc-48ad-b274-e81cf19e7e26
captured: 2026-05-17T17:01:42+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/4a6350d4-09fc-48ad-b274-e81cf19e7e26.jsonl
---

## ADR Inline template/-контент у .mdc при sync замість збереження посилань

## Context and Problem Statement
Після Phase 0+1 реалізації `template/` каталогів у `npm/rules/<id>/` посилання виду `[package.json.snippet.json](./policy/package_json/template/package.json.snippet.json)` в `security.mdc` стали валідними всередині монорепо. Але `n-cursor` sync копіює лише `<id>.mdc`, без сусідніх `template/` директорій — тож у `.cursor/rules/n-security.mdc` споживача ці посилання вказують у неіснуюче місце.

## Considered Options
* Inline: при sync читати кожен `template/`-файл і замінити markdown-посилання на fenced code block з вмістом файла
* Абсолютний GitHub URL у `.mdc` замість відносних посилань
* Копіювати `template/` у `.cursor/rules-data/<id>/` і переписувати посилання

## Decision Outcome
Chosen option: "Inline", because `.mdc` у споживача повинен бути self-contained (як він уже є зараз без `template/`); це зберігає одне джерело правди і не вимагає інтернету для перегляду канону.

### Consequences
* Good, because transcript фіксує очікувану користь: `.cursor/rules/n-security.mdc` після sync містить повний TOML/JSON канон у fenced-блоках замість зламаних посилань.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Нова утиліта: `npm/scripts/utils/inline-template-links.mjs`, export `inlineTemplateLinks(text, ruleDir)`
- Regex: `/\[([^\]]+)\]\((\.\/[^)]*\/template\/[^)]+)\)/g` — чіпає лише `./…/template/…` посилання
- Вбудовано у `readBundledRuleContent` в `npm/bin/n-cursor.js`
- Файл не знайдено → кидає помилку (sync падає, помітно для розробника)
- 10 unit-тестів у `npm/scripts/utils/inline-template-links.test.mjs`

---

## ADR Нормалізація label у inlineTemplateLinks: strip .snippet.<ext>

## Context and Problem Statement
Перша версія `inlineTemplateLinks` брала label з тексту markdown-посилання, тому в `.cursor/rules/n-security.mdc` виводилось: `` `package.json.snippet.json`: `` замість очікуваного `` `package.json`: ``.

## Considered Options
* Використовувати basename файла після strip суфіксів `.snippet.<ext>`, `.deny.<ext>`, `.contains.<ext>`
* Залишати label з markdown-джерела без змін

## Decision Outcome
Chosen option: "basename після strip суфіксів", because label повинен відображати ціль (target), а не тип артефакту; `.snippet.json` — це деталь зберігання, а не назва для читача.

### Consequences
* Good, because transcript фіксує очікувану користь: виводиться `` `package.json`: `` замість `` `package.json.snippet.json`: ``.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Реалізовано через `normalizeTargetName(basename)` у `npm/scripts/utils/inline-template-links.mjs`
- Regex: `^(.+)\.(snippet|deny|contains)\.[^.]+$` → group 1
- Для `.gitleaks.toml.snippet.toml` label → `.gitleaks.toml`; для `package.json.snippet.json` → `package.json`
- Тест-кейси у `inline-template-links.test.mjs` для `.snippet.json`, `.deny.json`, `.contains.json`, `.snippet.toml`

---

## ADR Function replacer у String.replace для уникнення $-interpolation

## Context and Problem Statement
`inlineTemplateLinks` використовувала `String.replace(fullMatch, replacement)` де `replacement` — текстовий рядок. Коли вміст `template/.gitleaks.toml.snippet.toml` містив `'''.*\.lock$'''` (TOML raw strings із `$'`), JavaScript інтерпретував `$'` як "рядок після матчу" і весь хвіст `.mdc` реінжектувався всередину fenced-блоку.

## Considered Options
* Замінити рядковий replacer на function replacer: `result.replace(fullMatch, () => replacement)`
* Екранувати `$` у replacement перед передачею у `String.replace`

## Decision Outcome
Chosen option: "function replacer", because function replacer повністю ігнорує спеціальну семантику `$`-паттернів і не потребує ескейпінгу.

### Consequences
* Good, because transcript фіксує очікувану користь: TOML з `$'''` правильно вставляється після фіксу, 10/10 тестів проходять.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Фікс у `npm/scripts/utils/inline-template-links.mjs`, рядок з `result.replace(fullMatch, () => replacement)`
- Регресійна фікстура: `npm/scripts/utils/__fixtures__/inline-template/fix/foo/template/with-dollar.toml`
- Коміт: `fix(npm): inlineTemplateLinks — escape $-patterns in replacement (use function replacer)` (`6df1de2`)

---

## ADR Шаблон міграції policy-концернів на data.template.* (ga rule як Phase 2)

## Context and Problem Statement
Після security-пілота (Phase 0+1) rego-файли `ga` rule мали inline literals: `"n-cursor lint-ga"`, `"github.vscode-github-actions"`, `"oxc.oxc-vscode"`, `"ref-pin"`. При зміні канону їх треба оновлювати у двох місцях. Обраний підхід — вивести канон у `template/<target>.<slot>.<ext>` і передавати через `conftest --data`.

## Considered Options
* Inline literals у rego (статус кво до міграції)
* `data.template.*` через `--data <tmpfile>` з `template/<target>.<slot>.<ext>` файлів концерну

## Decision Outcome
Chosen option: "`data.template.*` через `--data`", because security-пілот довів: канон в одному місці (`template/`), rego-тести мокають `data.template` через `with`, orchestrator (`run-rule.mjs` + `resolveConcernTemplateData`) автоматично передає дані без змін у запусковому коді.

### Consequences
* Good, because transcript фіксує очікувану користь: 15/15 opa тестів для `ga/policy/` проходять; `findMissingMdcRefs` повертає `[]` після оновлення `ga.mdc`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- 4 нові `template/` каталоги: `ga/policy/{package_json,vscode_extensions,vscode_settings,zizmor_yml}/template/`
- Слоти: `package_json` → `.contains.json`; `vscode_extensions` → `.snippet.json`; `vscode_settings` → `.snippet.json`; `zizmor_yml` → `.snippet.yml`
- Rego-тести в кожному пакеті мокають `data.template` через `with data.template as template_data`; drift-тест (`test_data_template_drives_*`) підтверджує RED перед міграцією
- `ga.mdc` оновлено секцією `## Канон фрагментів` з markdown-посиланнями на всі 4 `template/` файли
- Коміт: `release(npm): v1.13.9 — ga rule template/ migration (Phase 2)` (`3c98ecb`)
