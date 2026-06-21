---
type: ADR
title: "Єдиний entrypoint правила — main.mjs з run/lint експортами, meta-driven"
description: "Кожне правило npm/rules/<id>/ має рівно один файл-точку входу main.mjs з іменованими експортами run() (check) та опційним lint(); поверхні драйвить meta.json#lint, а не наявність файлу"
---

# ADR: Єдиний entrypoint правила — main.mjs з run/lint експортами, meta-driven

**Дата:** 2026-06-21
**Статус:** Прийнято
**Версія `@nitra/cursor`:** 12.6.1 (міграція націлена на наступний major)

## Context and Problem Statement

Кожне правило живе у `npm/rules/<id>/` і зараз має **кілька** файлів-точок входу на одну логічну сутність:

- `check.mjs` у корені — **38× байт-у-байт ідентичний** boilerplate (`runStandardRule(import.meta.dirname)`). Це не лише зручність для `bun rules/<id>/check.mjs`: conformance-фаза спавнить його як окремий процес по жорсткому шляху для **кожного** правила — `run-conformance-check.mjs:72` (`spawnSync('bun', [join(BUNDLED_RULES_DIR, id, 'check.mjs')])`). Тобто файл — load-bearing інфраструктура.
- `js/lint.mjs` — лінт-точка, яку оркестратор знаходить по жорсткому шляху `rules/<id>/js/lint.mjs` (`orchestrate.mjs:100,176`). Мають 14 правил.
- `lint/lint.mjs` — bespoke-реалізація зовнішніх тулз (actionlint/zizmor/ruff/mypy/shellcheck…) для **8** правил (`ga, docker, k8s, php, python, rego, text, doc-files`). У цих правил `js/lint.mjs` вироджується у 1-рядковий делегат (`import { runLintGaCli } from '../lint/lint.mjs'`). Цей же файл експортує `runLint<Id>Cli` для bin-підкоманд `lint-ga`/`lint-rego`/`lint-k8s`/`lint-docker`/`lint-text`/`lint-doc-files`. `run-standard-lint.mjs:10` виводить `ruleId` із **шляху** `rules/<id>/lint/lint.mjs`.

Як наслідок для одного lint-правила існує **три** файли на одну точку входу (`check.mjs` + `js/lint.mjs`-делегат + `lint/lint.mjs`), а назва `check.mjs` ще й вужча за фактичний зміст (файл робить `applies → JS → policy → mdc-refs`, а не лише «check»).

Ключове спостереження: `meta.json#lint` (значення `per-file`/`full`) — **ідеальний 1:1 сигнал** наявності лінт-поверхні. Кожне правило з `js/lint.mjs` має `meta.lint`, і навпаки. Отже, факт «це lint-правило» вже задекларовано в meta — імені файлу його дублювати не потрібно.

Проблема: як уніфікувати точку входу правила до **рівно одного** файлу з передбачуваним іменем і розташуванням, не плодячи `check.mjs`-vs-`lint.mjs` дихотомію у назвах файлів.

## Considered Options

- **A — `check.mjs` xor `lint.mjs` у корені.** Перенести `lint/lint.mjs` → корінь `lint.mjs`, видалити делегат `js/lint.mjs`; check-правила лишають `check.mjs`. Мінус: дві назви файлів кодують поверхню; для lint-правил лишається hand-wave «`lint.mjs` поглинає check».
- **B — універсальний entrypoint з `run`/`lint` експортами, ім'я `index.mjs`.** Ідіоматичний для directory-import. **Відхилено на реалізації:** per-file дока entrypoint-а — `docs/<stem>.md`, тож `index.mjs` → `docs/index.md`, що **колізує** з зарезервованою авто-генерованою докою `docs/index.md` (`type: Directory Index`, є в кожній теці-правилі). lint-doc-files перегенерував би Directory Index як JS Module і затер його. До того ж directory-import у фреймворку не використовується — conformance спавнить явний шлях файлу.
- **C — універсальний entrypoint з `run`/`lint` експортами, ім'я `main.mjs`.** Те саме, що B, але нейтральне ім'я `main.mjs` без колізії (`docs/main.md`). Кожне правило (100%, без винятків) має рівно `main.mjs`. `export function run()` = check (усі правила); `export function lint(files)` = lint (лише `meta.lint`-правила). Bespoke-логіка зовнішніх тулз лишається у `js/`-хелперах; `main.mjs` тонкий.

## Decision Outcome

Обрано **варіант C** — універсальний `main.mjs` з `run`/`lint` експортами, applicability драйвить `meta.json`.

Обґрунтування: результат 1:1 по `meta.lint` — клінчер. Ім'я файлу не повинно дублювати те, що `meta.json` уже декларує. A лишає дві назви файлів і «subsumes» hand-wave; B має чисту семантику, але `index.mjs` колізує з `docs/index.md` (Directory Index) — реальний блокер, виявлений на реалізації. C дає справжню уніфікацію — одне нейтральне ім'я скрізь, тип через meta + експорти, обидві поверхні чітко розділені в одному модулі. `.n-cursor.json` посилається на правила за **id теки** (не за файлом), тож рейнейм entrypoint конфіг користувача не чіпає.

**Цільова конвенція.** `npm/rules/<id>/` містить:
- `<id>.mdc`, `meta.json` — декларатив;
- `main.mjs` — єдиний entrypoint: `export function run(ctx)` (check, через `runStandardRule`) + опційно `export function lint(files)` (лінт), present ⇔ `meta.lint` задано;
- концерни як і раніше: `js/<concern>.mjs`, `policy/<concern>/`, хелпери у `js/`.

**Необхідні зміни у фреймворку (без них — поломка):**
1. `run-conformance-check.mjs` — спавнити check не по `rules/<id>/check.mjs`, а через `resolveRuleEntrypoint` (`main.mjs` → fallback `check.mjs`). **[Ф1 зроблено]**
2. `orchestrate.mjs` — gate за `meta.lint` (`hasLintSurface`), entrypoint через `resolveLintEntrypoint` (`main.mjs` → fallback `js/lint.mjs`). **[Ф1 зроблено]**
3. bin-підкоманди `lint-<id>` (`runLint<Id>Cli`) та будь-які імпортери `rules/<id>/lint/lint.mjs` — перенаправити на `main.mjs::lint`. На міграції перегрепати споживачів `runLint*Cli` і шлях `/lint/lint.mjs`.
4. `run-standard-lint.mjs` — деривація `ruleId` зі шляху `rules/<id>/lint/lint.mjs` має враховувати нове розташування (`rules/<id>/main.mjs`).
5. Оновити коментарі-конвенції в `discover-checkable-rules.mjs`, доки/тести шляхів, `build-agents-commands.mjs`.

**Фази міграції (щоб не ламати на півдорозі):**
- **Ф1 [зроблено]** — generic conformance-runner + dual-path discovery (приймає і `check.mjs`, і `main.mjs`); оркестратор приймає і `js/lint.mjs`, і `main.mjs::lint`, gated по `meta.lint`. Юніт-тести dual-path у `orchestrate.test.mjs`.
- **Ф2 [зроблено]** — перенос усіх 38 правил на `main.mjs`: 24 check-only `check.mjs`→`main.mjs`; 14 lint — `main.mjs` (`run` + `export { lint } from './js/lint.mjs'`). Контракт `check-mjs-contract.test.mjs` + `list-rule-ids.mjs` на dual-path, тоді (Ф3.1) main.mjs-only.
- **Ф3 [зроблено]** — прибрано dual-path fallbacks (main.mjs-only); згорнуто всі `lint/`-підтеки в `js/` (6 делегатів → `js/lint.mjs`; docker `runLintDocker` → `js/lint-docker.mjs`; doc-files CLI → `js/run-lint.mjs`). `run-standard-lint` ruleId без змін — `js/` той самий рівень, що `lint/`. bin `lint-doc-files` ланцюг збережено. Реалії проти плану: bin-підкоманди `lint-<id>` (п.3) виявились НЕ задіяними (лише `lint-doc-files`); `run-standard-lint` (п.4) НЕ потребував змін (імпл лишився під `rules/<id>/`).

## Consequences

**Good:**
- Рівно один entrypoint-файл на правило, однакове ім'я скрізь — без `check`-vs-`lint` дихотомії в назвах.
- `meta.json` стає єдиним джерелом істини «чи правило лінтить» (замість `existsSync(file)`).
- Зникає трифайловий дубль для 8 lint-правил і 38× boilerplate `check.mjs`.
- `main.mjs` не колізує з `docs/index.md` (Directory Index), на відміну від `index.mjs`.

**Bad / ризики:**
- Найбільший ризик — зміна conformance-runner (`run-conformance-check.mjs:72` спавнить по жорсткому шляху): помилка тут ламає check для **всіх** правил. Тому Ф1 робить dual-path, а не разовий cut-over.
- Голий `main.mjs` менш «greppable» з першого погляду — щоб знати, чи правило лінтить, читаєш `meta.json` (пом'якшено тим, що meta й так source of truth).
- Breaking для зовнішніх споживачів, що спавнили `bun rules/<id>/check.mjs` напряму — замінюється на `n-cursor check <id>` / `bun rules/<id>/main.mjs`.

## More Information

- Boilerplate-доказ: усі 38 `check.mjs` дають однаковий нормалізований хеш тіла.
- Точки прив'язки коду: `npm/scripts/lib/fix/run-conformance-check.mjs:72`, `npm/rules/lint/js/orchestrate.mjs:100,176`, `npm/scripts/lib/run-standard-lint.mjs:10`, `npm/scripts/lib/discover-checkable-rules.mjs`, `npm/scripts/build-agents-commands.mjs:22-25`.
- Doc-конвенція-колізія: `docs/index.md` = `type: Directory Index` у кожній теці → entrypoint не може зватися `index.mjs`.
- Інвентар lint-правил: зовн.-тулзи (×8) `ga, docker, k8s, php, python, rego, text, doc-files`; лише per-file/full без `lint/` (×6) `rust, security, style-lint, image-compress, js-lint, js-lint-ci`.
- Пов'язано: попередній рефактор `js/<concern>/check.mjs` → flat `js/<concern>.mjs` (1.13.90+) та `20260516-rules-fix-lint-policy-structure.md`.

## Update 2026-06-21 — lint-поверхню заінлайнено в main.mjs

Після Ф3 lint-імпл лишався в `js/lint.mjs`, а `main.mjs` його re-export'ив. Це
давало дві вади: `js/lint.mjs` дискаверився як **no-op concern** (`listJsConcerns`
сканує `js/*.mjs`, але `lint.mjs` не має `export check` → дарма імпортувався під час
кожного conformance-прогону), плюс зайва indirection `main.mjs → js/lint.mjs`.

Рішення: для всіх lint-правил **заінлайнити** `lint`-поверхню в `main.mjs` (один файл =
правило), `js/lint.mjs` видалити. Виняток — **docker**: його `js/lint.mjs` має `export
check` (реальний concern Dockerfile-структури), тож лишається в `js/`, а `main.mjs`
re-export'ить `lint` звідти.

Enabling-зміни: `run-standard-lint.mjs` ruleId-деривація стала глибино-незалежною (сегмент
після `rules/`, бо `import.meta.dirname` з `main.mjs` = `rules/<id>`, а не `rules/<id>/js`);
`npm-module/rule_meta.mjs` чек `meta.lint` ⟺ **`main.mjs` експортує `lint`** (замість
наявності `js/lint.mjs`); важкі bespoke-хелпери (actionlint/cspell/докген-скан тощо)
лишаються окремими модулями в `js/`, `main.mjs` їх імпортує.
