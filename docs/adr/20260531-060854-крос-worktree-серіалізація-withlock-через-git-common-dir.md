---
session: 09dcb1bc-929b-4d88-90b0-c0611bed3d2f
captured: 2026-05-31T06:08:54+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/09dcb1bc-929b-4d88-90b0-c0611bed3d2f.jsonl
---

Worktree не зберігся після перерви контексту. Але поточне завдання — аналіз транскрипту та генерація ADR. Ось результат:

---

## ADR Крос-worktree серіалізація `withLock` через git-common-dir

## Context and Problem Statement

`withLock` зберігав стан локу (lock-директорія, `owner.json`, `result.json`) у `node_modules/.cache/n-cursor/<key>/` відносно `process.cwd()`. Оскільки кожен git-worktree має окремий `node_modules`, два агенти в різних worktree не бачили локів одне одного і могли одночасно запускати важкі команди (`eslint`, Stryker), перевантажуючи CPU/диск.

## Considered Options

* Зберегти `cacheDir` у git-common-dir (спільний для всіх worktree)
* Мітка у назві worktree як ознака «вже запущено»

## Decision Outcome

Chosen option: "Зберегти `cacheDir` у git-common-dir", because мітка в назві worktree не дає TOCTOU-захисту, не відстежує живість процесу і не перекриває ручний `bun run lint` у головному checkout; git-common-dir однаковий для головного checkout і всіх linked-worktree, тому `mkdirSync`-lock стає справжнім крос-worktree мьютексом.

### Consequences

* Good, because transcript фіксує очікувану користь: `withLock` серіалізує важкі команди між worktree без зміни публічного API — `opts.cacheDir` досі має пріоритет.
* Bad, because transcript не містить підтверджених негативних наслідків (fallback на `node_modules/.cache/...` зберігається для середовищ поза git-репо).

## More Information

Нові файли: `npm/scripts/utils/lock-cache-dir.mjs` (функція `resolveLockCacheDir(key)`), `npm/scripts/utils/tests/lock-cache-dir.test.mjs` (16 тестів). Змінено: `npm/scripts/utils/with-lock.mjs` рядок 66 — `const cacheDir = opts.cacheDir ?? resolveLockCacheDir(key)`. Changeset: `npm/.changes/1780162853358-7a418d.md` (`bump: minor`). Реалізовано через `git rev-parse --git-common-dir`; результат — `.git/n-cursor/<key>`.

---

## ADR `auto.md` → `meta.json` зі схемою та полем `worktree` для скілів

## Context and Problem Statement

Кожен скіл у `npm/skills/<id>/` мав `auto.md` — однорядковий markdown-файл з умовою автоактивації. Формат не розширюваний (неможливо додати нові поля без зламу парсера), не валідований JSON-схемою і не дозволяє декларувати нову поведінку — зокрема, що скіл має запускатися в окремому git-worktree.

## Considered Options

* `meta.json` (B1) — структурований JSON зі схемою
* `meta.yaml` (B2) — YAML-frontmatter стиль
* Markdown-файл з YAML frontmatter (B3)
* Інші варіанти в transcript не обговорювалися для решти форматів.

## Decision Outcome

Chosen option: "`meta.json`", because `auto-skills.mjs` є суто програмним парсером, JSON-схема вже практикується в репо (`npm/schemas/`), і `check`-правило легко валідує обидва поля (`auto`, `worktree`).

### Consequences

* Good, because transcript фіксує очікувану користь: єдине структуроване джерело правди для умови автоактивації і worktree-прапорця; JSON-схема забезпечує машинну валідацію.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Spec: `docs/superpowers/specs/2026-05-30-skill-meta-json-worktree-design.md`. Plan: `docs/superpowers/plans/skill-meta-json-worktree.md`. Поля схеми: `auto` (`"завжди"` | `string[]`, опційне), `worktree` (`boolean`, обовʼязкове). Дві окремі схеми (E2): `npm/schemas/skill-meta.json` (skills: `auto`+`worktree`), rules-схема — в наступному spec. Міграція 9 `auto.md` → `meta.json`.

---

## ADR Worktree-прапорець скіла: `true` ⇒ заборона паралельного запуску

## Context and Problem Statement

Скіли, що мутують репо і виграють від ізоляції на гілку (`fix`, `taze`, `coverage-fix`, `fix-tests`, `adr-normalize`), логічно запускати в окремому git-worktree. Але введення worktree-поля без обмеження паралельності лише перенесло б ризик CPU-перевантаження з одного checkout до кількох.

## Considered Options

* Булеве `worktree` + неявна заборона паралелі для `true` (C1)
* Enum із трьох станів: `required`/`allowed`/`forbidden` (C2)
* Enum + окреме поле `parallelSafe` (C3)

## Decision Outcome

Chosen option: "Булеве `worktree` + неявна заборона паралелі для `true` (C1)", because паралельність уже захищена `withLock` (крос-worktree після попередньої зміни), тож окреме поле дублювало б наявний механізм; три стани C2 не потрібні, бо «заборонено» — це `false`, а не окрема категорія.

### Consequences

* Good, because transcript фіксує очікувану користь: будь-який скіл із `worktree: true` автоматично позначений як «один інстанс за раз»; правило явно зафіксоване в D2-блоці, вшитому в `SKILL.md` при синку.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Початкові значення: `worktree: true` — `fix`, `taze`, `coverage-fix`, `fix-tests`, `adr-normalize`; `worktree: false` — `lint`, `start-check`, `llm-patch`, `publish-telegram`. Принцип: `true` для генеративних скілів (детерміновані зміни незалежно від поточного дерева), `false` для реактивних (працюють на незакомічених змінах поточного checkout) і read-only. `lint` лишився `false` саме як реактивний, а не через CPU-вагу (CPU вирішено `withLock`). D2-блок вшивається між маркерами `<!-- n-cursor:worktree:start -->` / `<!-- n-cursor:worktree:end -->` — ідемпотентно.

---

## ADR Rules `auto.md` залишається до окремого spec (G1 data-driven migration)

## Context and Problem Statement

`npm/rules/<id>/auto.md` у 29 правилах містить лише людиночитаний опис умови; фактична логіка автодетекту захардкоджена в `auto-rules.mjs` (`AUTO_RULE_ORDER`, `AUTO_RULE_DEPENDENCIES`, `collectAutoRuleFacts`, `autoRuleChecks`). Унаслідок цього rules і skills мають різну природу `auto`: у skills — машинно-парситься, у rules — документація.

## Considered Options

* Уніфікувати rules до `meta.json` у цьому ж spec (проза 1:1, `auto-rules.mjs` не зачіпати) (F1)
* Повний data-driven рефакторинг: умови в `meta.json`, реєстр предикатів для незводимих перевірок (G1) — окремий spec
* Гібрид: прості умови в дані, складні лишаються в коді (G2)

## Decision Outcome

Chosen option: "G1 окремим spec", because G1 — єдиний варіант, що виносить логіку на рівень `meta.json` без залишкового хардкоду; але він приблизно подвоює обсяг (переписування ядра `auto-rules.mjs` + міграція 28 правил), тому виноситься в окремий цикл spec→plan→impl після завершення skills-міграції.

### Consequences

* Good, because transcript фіксує очікувану користь: skills-spec залишається зосередженим і ризикованим лише по скілах; rules-міграція отримує власний цикл з перевіркою.
* Bad, because тимчасово в репо співіснують два механізми: `rules/*/auto.md` (проза) і `skills/*/meta.json` (JSON). Transcript це явно фіксує як прийнятний компроміс.

## More Information

Spec-файл для G1 заплановано після завершення `docs/superpowers/plans/skill-meta-json-worktree.md`. Rules `auto.md` у поточному spec не видаляються і не переносяться. `auto-rules.mjs` не зачіпається.
