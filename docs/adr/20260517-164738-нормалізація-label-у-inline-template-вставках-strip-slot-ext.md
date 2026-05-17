---
session: 4a6350d4-09fc-48ad-b274-e81cf19e7e26
captured: 2026-05-17T16:47:38+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/4a6350d4-09fc-48ad-b274-e81cf19e7e26.jsonl
---

## ADR Нормалізація label у inline-template вставках: strip .<slot>.<ext>

## Context and Problem Statement
Після реалізації `inlineTemplateLinks` результуючий `.cursor/rules/n-security.mdc` містив рядки на кшталт `` `lint-security` скрипт: `package.json.snippet.json`: `` — технічне імʼя файлу шаблону, а не цільовий файл, який читає споживач правила. Це заплутує людину, яка бачить синкнуте правило без знання про `template/`-інфраструктуру.

## Considered Options
* Лишати оригінальний label із посилання (`package.json.snippet.json`)
* Нормалізувати label: відкидати `.<slot>.<ext>` суфікс → показувати тільки базове імʼя цільового файлу (`package.json`)

## Decision Outcome
Chosen option: "Нормалізувати label: відкидати `.<slot>.<ext>`", because споживач правила повинен бачити цільовий файл (`package.json`), а не артефакт template-конвенції.

### Consequences
* Good, because transcript фіксує очікувану користь: `n-security.mdc` рядки типу `` `lint-security` скрипт: `package.json`: `` читаються природно для споживача.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Реалізовано у `npm/scripts/utils/inline-template-links.mjs` через helper `normalizeTargetName(filename)`: regex `/\.(snippet|deny|contains)\.[^.]+$/` відкидає суфікс, потім `basename()` відкидає шлях. Тести: `npm/scripts/utils/inline-template-links.test.mjs` — 4 нових кейси (`strips .snippet.<ext>`, `strips .deny.<ext>`, `strips .contains.<ext>`, `dot-prefixed target (.gitleaks.toml)`). Label із оригінального markdown-лінку ігнорується; завжди береться basename файлу після нормалізації.

---

## ADR Жорстке падіння sync при відсутньому template-файлі

## Context and Problem Statement
У першому дизайні `inlineTemplateLinks` пропонувалася fail-safe поведінка: якщо файл із `./…/template/…` не існує — лишати лінк як є, без помилки. Це приховало б помилку від розробника, який неправильно додав лінк у `.mdc`.

## Considered Options
* Fail-safe: зберігати оригінальний markdown-лінк якщо файл не знайдено
* Fail loudly: кидати помилку, яка ламає `n-cursor` sync

## Decision Outcome
Chosen option: "Fail loudly", because "потрібно фейлити щоб було замітно для користувача" — silently skipping зробить баг невидимим.

### Consequences
* Good, because transcript фіксує очікувану користь: розробник відразу побачить проблему при синку.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`inlineTemplateLinks` у `npm/scripts/utils/inline-template-links.mjs` кидає `Error` з повідомленням `inlineTemplateLinks: <rel> (referenced in …) не знайдено`. Покрито тестом `'missing file throws'` у `inline-template-links.test.mjs`.

---

## ADR Function replacer замість string replacement для інлайнінгу template-вмісту

## Context and Problem Statement
`String.replace(needle, replacementStr)` інтерпретує спецсеквенції `$'`, `$&`, `$1` у рядку заміни. Файл `.gitleaks.toml.snippet.toml` містить TOML raw strings виду `'''.*\.lock$'''`, де `$'` — "tail after match" в JavaScript. Це спричиняло вставку хвоста `.mdc`-документа всередину TOML-блоку, ламаючи синкнутий файл.

## Considered Options
* Використовувати `String.replace(needle, replacementStr)` (поточна реалізація)
* Використовувати function replacer: `String.replace(needle, () => replacement)`

## Decision Outcome
Chosen option: "Function replacer `() => replacement`", because function replacer не підлягає `$`-інтерполяції — returnValue трактується буквально.

### Consequences
* Good, because transcript фіксує очікувану користь: тест `'preserves $ characters in template content'` пройшов після фіксу; синкнутий `n-security.mdc` став коректним.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Фікс у `npm/scripts/utils/inline-template-links.mjs`: `result = result.replace(fullMatch, () => replacement)`. Регресійна фікстура: `npm/scripts/utils/__fixtures__/inline-template/fix/foo/template/with-dollar.toml` (`paths = ['''.*\.lock$''']`). Коміт: `6df1de2 fix(npm): inlineTemplateLinks — escape $-patterns in replacement (use function replacer)`. Версія `npm/package.json` бампнута `1.13.6 → 1.13.7`.
