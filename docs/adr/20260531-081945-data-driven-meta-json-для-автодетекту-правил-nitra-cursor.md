---
session: 09dcb1bc-929b-4d88-90b0-c0611bed3d2f
captured: 2026-05-31T08:19:45+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/09dcb1bc-929b-4d88-90b0-c0611bed3d2f.jsonl
---

Проаналізую transcript і виведу ADR для ключових рішень.

## ADR Data-driven `meta.json` для автодетекту правил `@nitra/cursor`

## Context and Problem Statement
Кожне правило в `npm/rules/<id>/` мало людинозрозумілий файл `auto.md`, що описував умову автоактивації. Ядро `detectAutoRules()` в `npm/scripts/auto-rules.mjs` читало ці файли, але реальна логіка була захардкодована у функції (якщо файл присутній — застосовувався відповідний if-блок із коду). Синхронізація між `auto.md` і кодом потребувала ручної підтримки і не давала машинно-читаємого джерела правди.

## Considered Options
* G1 — повний data-driven: `meta.json` із декларативним полем `auto` (4 форми); код-реєстр лише для незводимих предикатів
* Hardcoded map у коді (поточний стан — без змін)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "G1 — повний data-driven `meta.json`", because поле `auto` у `meta.json` стає машинно-читаємим джерелом правди для кожного правила, прибирає синхронізаційний дрейф між `auto.md` і кодом і дзеркалює вже затверджену схему для скілів (`npm/skills/*/meta.json`).

### Consequences
* Good, because transcript фіксує очікувану користь: `AUTO_RULE_ORDER` і `AUTO_RULE_DEPENDENCIES` виводяться з даних (прибирається хардкод-масив); нові правила підхоплюються без змін у ядрі.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Spec: `docs/superpowers/specs/2026-05-31-rule-meta-json-design.md`
- Plan: `docs/superpowers/plans/2026-05-31-rule-meta-json.md`
- Ядро міграції: `npm/scripts/auto-rules.mjs` (функція `detectAutoRules`)
- Шаблон схеми: `npm/skills/*/meta.json` (аналогічний підхід, реалізований у Spec A)
- Регресійний контракт: `npm/scripts/tests/auto-rules.test.mjs` (~45 тестів)

---

## ADR Єдина glob-форма для файлових умов автодетекту правил

## Context and Problem Statement
Первинний дизайн поля `auto` у `meta.json` для правил передбачав три окремі форми файлових умов: `anyFile` (файл будь-де), `rootFile` (тільки в корені) і `dir` (наявність каталогу). Різні форми ускладнювали схему і потребували окремої логіки інтерпретатора для кожного випадку.

## Considered Options
* Три окремі форми: `anyFile`, `rootFile`, `dir`
* Єдина glob-форма: `{ "auto": { "glob": "<pattern>" } }` — рядок або масив рядків

## Decision Outcome
Chosen option: "Єдина glob-форма `{ glob }`", because glob-патерн природно кодує всі три варіанти: `package.json` (тільки корінь), `**/package.json` (будь-де), `.github/workflows/**` (каталог); схема спрощується до одного виду для 13 правил.

### Consequences
* Good, because transcript фіксує очікувану користь: один інтерпретатор замість трьох гілок; `globToRegex` вже існує в `npm/rules/npm-module/js/package_structure.mjs:374` — перевикористовується без додаткової залежності.
* Bad, because семантика для **порожніх каталогів** змінилась: `existsSync(dir)` тригерив навіть на порожній `k8s/`, `<dir>/**` — ні. Transcript фіксує це як свідому, прийнятну зміну (порожній каталог правила не несе сенсу).

## More Information
- Spec: `docs/superpowers/specs/2026-05-31-rule-meta-json-design.md` (таблиця glob-мапінгу 13 правил)
- `globToRegex`: `npm/rules/npm-module/js/package_structure.mjs:374`
- Каталоги (`ga`, `k8s`, `npm-module`): патерни `.github/workflows/**`, `**/k8s/**`, `npm/**`

---

## ADR Автоматична активація правила `tauri` (раніше мертвий код)

## Context and Problem Statement
Правило `tauri` мало `auto.md` з умовою «`@tauri-apps/api` у залежностях», але під час інвентаризації виявлено, що жоден блок `auto-rules.mjs` не перевіряв цієї умови — `auto.md` лежало без відповідного if-блоку у функції `detectAutoRules()`.

## Considered Options
* Увімкнути автодетект через `meta.json`: `{ "auto": { "predicate": "depInAnyPackageJson", "arg": ["@tauri-apps/api"] } }`
* Лишити `tauri` opt-in (без `auto` у `meta.json`), зберігши поточну поведінку

## Decision Outcome
Chosen option: "Увімкнути автодетект через `meta.json`", because міграція на data-driven підхід — природний момент виправити dead-code: `auto.md` декларував намір, якого ніколи не було в коді; запуск предиката `depInAnyPackageJson` узгоджений з наявним реєстром предикатів.

### Consequences
* Good, because правило `tauri` вперше реально автоактивуватиметься у репо з `@tauri-apps/api` — усуває розбіжність між задекларованою і фактичною поведінкою.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Виявлено під час Explore-аудиту `auto-rules.mjs` у рамках планування Spec B
- Предикат: `depInAnyPackageJson` (реєстр `npm/scripts/lib/rule-predicates.mjs`, Task 2 плану)
- Plan: `docs/superpowers/plans/2026-05-31-rule-meta-json.md` (Task 3 — `npm/rules/tauri/meta.json`)
