---
session: c3ee6058-20c8-4e12-8aef-0a36a996fed5
captured: 2026-05-23T21:52:36+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/c3ee6058-20c8-4e12-8aef-0a36a996fed5.jsonl
---

## ADR Перейменування `rules/<id>/fix/` → `rules/<id>/js/`

## Context and Problem Statement
У пакеті `@nitra/cursor` JS-концерни правил зберігалися у каталозі `rules/<id>/fix/<concern>/check.mjs`. Назва `fix/` відображала функцію (перевірка/виправлення), а не технологію — на відміну від сусіднього каталогу `policy/`, що містить `.rego`-файли. Це порушувало симетрію і ускладнювало розуміння структури.

## Considered Options
* Зберегти `fix/` (без перейменування)
* Перейменувати `fix/` → `js/` (назва за технологією, як і `policy/`)

## Decision Outcome
Chosen option: "Перейменувати `fix/` → `js/`", because назва `js/` відповідає технологічній осі (`js/` ↔ `policy/`), а не функціональній; спільний принцип, згаданий у план-документі `docs/superpowers/plans/2026-05-23-per-rule-fix-mjs-entry-point.md`.

### Consequences
* Good, because transcript фіксує очікувану користь: структура `js/ | policy/` симетрична — обидва каталоги відображають реалізаційну технологію, а не призначення.
* Bad, because transcript не містить підтверджених негативних наслідків. 21 pre-existing lint-error у `with-lock.mjs` та `worktree-fingerprint.mjs` існували до міграції й не пов'язані з перейменуванням.

## More Information
Виконано через `git mv npm/rules/<id>/fix npm/rules/<id>/js` для 27 правил (3 правила — `ci4`, `efes`, `feedback` — не мали `fix/` взагалі). Залишкові посилання `fix/` у `.rego`, `.mdc`, `.cursor/rules/`, `scripts/`, `tests/` замінено через `perl -i.bak -pe 's|\bfix/|js/|g'`. Коміт: `refactor(rules): rename fix/ → js/ у всіх правилах` (89 файлів, 0 рядків змін — чистий `git mv`).

---

## ADR Канонічний `fix.mjs` як публічний entry-point кожного правила

## Context and Problem Statement
CLI `npx @nitra/cursor check` раніше знаходив правила через `discoverCheckableRules()` та запускав JS-концерни безпосередньо через `runRule()`. Це означало, що правило не мало власного стабільного entry-point, який можна було б викликати напряму (`bun rules/<id>/fix.mjs`) або через `dynamic import`.

## Considered Options
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Канонічний `fix.mjs` у кожному `rules/<id>/`", because план-документ і spec вимагали стабільного per-rule entry-point з єдиним контрактом `export async function run(ctx): Promise<number>`, що дозволяє як прямий запуск `bun rules/<id>/fix.mjs`, так і dynamic import у CLI.

### Consequences
* Good, because transcript фіксує очікувану користь: `bun rules/abie/fix.mjs` і `npx @nitra/cursor check abie` обидва повертають ідентичний результат; smoke-тест `fix-mjs-contract.test.mjs` перевіряє контракт 91 кейсом (1 sanity + 30×3).
* Bad, because 30 файлів `fix.mjs` ідентичні між собою. Їх створено через одноразовий генераторний скрипт `scripts/generate-fix-mjs.mjs`, видалений після прогону.

## More Information
Шаблон (11 рядків):
```js
import { runStandardRule } from '../../scripts/utils/run-standard-rule.mjs'
export async function run(ctx) { return runStandardRule(import.meta.dirname, ctx) }
```
Тест-контракт: `npm/tests/fix-mjs-contract.test.mjs` — перевіряє існування `fix.mjs`, наявність іменованого export `run`, відсутність legacy `fix/` каталогу. Коміт: `feat(rules): додати rules/<id>/fix.mjs у всіх 30 правилах`.

---

## ADR CLI `check` через `listRuleIds + dynamic import` замість `discoverCheckableRules + runRule`

## Context and Problem Statement
`bin/n-cursor.js` для команди `check` імпортував `discoverCheckableRules` і `runRule` напряму та оркестрував concerns усередині CLI. З появою per-rule `fix.mjs` entry-point з'явилась можливість делегувати оркестрацію самому правилу.

## Considered Options
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`listRuleIds + dynamic import + mod.run({walkCache})`", because `fix.mjs` є публічним контрактом правила — CLI повинен лише перебрати ідентифікатори й викликати `run()`, не знаючи деталей concerns. `discoverCheckableRules` і `runRule` залишаються — вони тепер викликаються всередині `runStandardRule`.

### Consequences
* Good, because transcript фіксує очікувану користь: CLI спростився (15 файлів changed, -5 net рядків у `bin/n-cursor.js`); `bun npm/bin/n-cursor.js check` та `bun npm/bin/n-cursor.js check abie` обидва пройшли smoke-перевірку з коректним результатом.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Нові утиліти: `scripts/utils/list-rule-ids.mjs` — повертає `string[]` ідентифікаторів правил (фільтр — наявність `fix.mjs`); `scripts/utils/walk-cache.mjs` — module-singleton `Map<string, Promise<string[]>>` переданий у `{walkCache}` щоб уникнути повторних FS-walk між concerns одного прогону. Коміт: `feat(cli): check-команда делегує rules/<id>/fix.mjs замість runRule`.

---

## ADR `walk-cache.mjs` як module-singleton з `resetWalkCache()` для тестів

## Context and Problem Statement
Кілька JS-концернів одного правила в межах одного `check`-прогону можуть звертатись до однакових списків файлів. Без кешу кожен concern виконує окремий FS-walk.

## Considered Options
* Передавати `Map` як параметр через увесь call stack
* Module-singleton (getOrCreateWalkCache / resetWalkCache)

## Decision Outcome
Chosen option: "Module-singleton", because план-документ явно вказав `module-singleton` з `resetWalkCache()` для ізоляції між тестами; module-instance живий у межах одного процесу, тому в production прогоні cache автоматично спільний.

### Consequences
* Good, because transcript фіксує очікувану користь: тести викликають `resetWalkCache()` у `beforeEach` — ізоляція гарантована; 4 тест-кейси у `tests/walk-cache.test.mjs` зелені.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/scripts/utils/walk-cache.mjs`. API: `getOrCreateWalkCache(): Map`, `resetWalkCache(): void`. Обмеження з плану: `import.meta.dirname` — Bun-specific (Bun ≥ 1.3, зафіксовано у `engines.bun >= 1.3` кореневого `package.json`). Коміт: `feat(utils): walk-cache module-singleton з reset для тестів`.
