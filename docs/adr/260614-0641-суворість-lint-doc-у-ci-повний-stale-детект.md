---
session: 4b386ce5-70e3-4c5a-b5f6-bcdd5aef68ed
captured: 2026-06-14T06:41:47+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/4b386ce5-70e3-4c5a-b5f6-bcdd5aef68ed.jsonl
---

## ADR Суворість `lint-doc` у CI: повний stale-детект

## Context and Problem Statement
Нова команда `lint-doc` розрізняє два види stale: `missing` (дока відсутня) і `crc-mismatch` (дока застаріла відносно джерела). Потрібно вирішити, яке із двох підмножин (`stale = missing ∪ crc-mismatch` чи лише `missing`) є порогом для CI.

## Considered Options
* Варіант 1 — повний stale-детект: CI падає на `missing` АБО `crc-mismatch`
* Варіант 2 — `--missing-only`: CI толерує `crc-mismatch`, падає лише на `missing`

## Decision Outcome
Chosen option: "Варіант 1 — повний stale-детект", because `--missing-only` залишає головну діру відкритою: доки тихо розсинхронізуються з кодом, борг накопичується без жодного CI-сигналу; повний стале-детект є закладеним у спеці режимом.

### Consequences
* Good, because будь-яка правка джерела без перегенерації доки ловиться в PR.
* Bad, because кожна зміна джерела вимагає локально запустити `fix-doc` і закомітити оновлену доку перед пушем; `--missing-only` лишається як опція команди, але не як режим CI.

## More Information
Спека: `docs/superpowers/specs/2026-06-12-doc-files-lint-doc-fix-doc-split.md`, секція 6, п.4. Передумова: Крок 0 — прогнати `fix-doc --full` до зеленого стану перед першим увімкненням CI, щоб не стартувати з накопиченим боргом.

---

## ADR `lint-doc` дефолт — changed-vs-origin; `--full` для повного скану; `--since <ref>` для явної бази

## Context and Problem Statement
Команда `lint-doc` мала бути «розумно обмеженою» за замовчуванням, щоб агенти і CI не сканували весь репозиторій щоразу. Потрібно вибрати дефолтну область і поверхню CLI.

## Considered Options
* Повний скан за замовчуванням, per-file як опція
* Дефолт = changed-vs-origin через `git diff --merge-base <base>`, `--full` для повного, `--since <ref>` для явної бази

## Decision Outcome
Chosen option: "Дефолт = changed-vs-origin, `--full` для повного, `--since <ref>` для явної бази", because агенти і CI мають однакову вхідну точку; права сторона diff — робоче дерево, тож незакомічені правки агента потрапляють у перевірку автоматично.

### Consequences
* Good, because одна команда (`lint-doc --since origin/$BASE_REF`) покриває і локального агента, і CI-job без розгалуження логіки.
* Good, because `git diff --merge-base` ловить і закомічене на гілці, і staged/unstaged зміни агента.
* Bad, because якщо `@{upstream}` не резолвиться (detached HEAD, гілка не пушена) — дефолтний `lint-doc` падає на `--full` (fail-closed), що може бути неочікуваним.

## More Information
Фінальна таблиця режимів (зафіксована у `docs/superpowers/specs/2026-06-14-lint-rule-consolidation.md`):

| Виклик | Область | Exit |
| --- | --- | --- |
| `lint-doc` | diff vs `@{upstream}` → `origin/HEAD` | 1 |
| `lint-doc --full` | весь репо | 1 |
| `lint-doc --since <ref>` | diff vs явний ref | 1 |
| `lint-doc --git` | vs HEAD (Stop-гейт) | 2 |

Резолв бази: `@{upstream}` → `origin/HEAD`; недосяжний base → fall-closed до `--full`. Повний скан лишається **локальним** (за `--full` або при недосяжній базі), не регулярним CI-кроком.

---

## ADR Зміна бази дельти: HEAD → origin (merge-base) для всіх per-file механізмів

## Context and Problem Statement
`collectChangedFiles` в `npm/scripts/lib/changed-files.mjs` рахував дельту **vs HEAD**, тобто бачив лише uncommitted зміни. Потрібно, щоб «changed» означало одне й те саме для агрегатора, `lint-doc` і `coverage`.

## Considered Options
* Лишити базу HEAD для агрегатора, окрема origin-база лише для `lint-doc`
* Уніфікувати всі per-file механізми на `resolveChangedBase()` (merge-base vs `main`/`origin/main`)

## Decision Outcome
Chosen option: "Уніфікувати всі per-file механізми на `resolveChangedBase()`", because база HEAD втрачає вже закомічені на гілці зміни; агент повинен бачити **своє** delta від origin, щоб CI і локальний прогін давали той самий результат.

### Consequences
* Good, because `collectChangedFilesSince(resolveChangedBase())` вже реалізований у `npm/scripts/lib/changed-files.mjs` і використовується `coverage --changed` — перевикористання без нового коду.
* Good, because «changed» означає те саме скрізь: агрегатор, doc, coverage, style-lint.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл з примітивами: `npm/scripts/lib/changed-files.mjs`. Функції: `resolveChangedBase()` (резолвить `main` → `origin/main` → `null`) і `collectChangedFilesSince(base)`. Зміна зачіпає orchestrator `n-cursor lint` quick-фазу і всі per-file lint.mjs.

---

## ADR Схема `meta.json:lint` — `{scope, ci}` замість `"quick"|"ci"`

## Context and Problem Statement
Поточне поле `meta.json:lint = "quick"|"ci"` змішує дві незалежні ознаки: декомпозованість (per-file vs крос-файл) і контекст запуску. `security` має різну поведінку залежно від контексту, що в старій схемі не виразити.

## Considered Options
* Залишити рядок `"quick"|"ci"`
* Нова схема: `{scope: "per-file"|"full", ci?: "full"}` плюс шорткат-рядок

## Decision Outcome
Chosen option: "Нова схема `{scope, ci}`", because вона ортогонально розділяє «чи детектор дробиться» і «як він веде себе у CI» — `security` отримує `{scope:"per-file", ci:"full"}`, решта — рядковий шорткат.

### Consequences
* Good, because одне поле виражає повну класифікацію без додаткових таблиць або умовної логіки в оркестраторі.
* Good, because `meta.json` не синкується до зовнішніх споживачів (підтверджено `scripts.mdc`), тож hard-rename всіх значень безпечний у межах одного коміту.
* Bad, because `parseRuleLintPhase` і `rule_meta.mjs:checkLintField` потребують оновлення для парсингу нового формату.

## More Information
Поточний валідатор: `npm/rules/npm-module/js/rule_meta.mjs` і `npm/scripts/lib/rule-meta.mjs` (функція `parseRuleLintPhase`, рядок 52+). Нові значення по механізмах зафіксовано у `docs/superpowers/specs/2026-06-14-lint-rule-consolidation.md`.

---

## ADR Три контексти запуску lint і роль `security` у CI

## Context and Problem Statement
Різні lint-механізми мають різну здатність до per-file виконання; крім того, `security` (trufflehog) технічно підтримує per-file, але в CI потребує повного скану з міркувань defense-in-depth. Потрібно стандартизувати, який набір перевірок запускається в кожному контексті.

## Considered Options
* Однакова поведінка скрізь (агент = CI = аудит)
* Три явних контексти: локальний агент / CI / повний аудит

## Decision Outcome
Chosen option: "Три явних контексти", because local-agent швидкість критична (лише per-file), CI потребує повноти для whole-tree механізмів і безпекового повного скану, аудит завжди повний.

### Consequences
* Good, because агент не блокується на `jscpd`/`knip`/`rego`/`ga`; CI лишається авторитетним для whole-tree гарантій.
* Good, because `security` у CI завжди full — гарантує ловлення секретів навіть якщо базовий baseline колись був неповним.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Фінальна класифікація механізмів (`scope` → контекст):

| Механізм | `scope` | Локальний агент | CI | Аудит |
| --- | --- | --- | --- | --- |
| `js-lint`, `style-lint`, `doc`, `text` | `per-file` | ✅ changed-vs-origin | ✅ changed-vs-origin | ✅ full |
| `security` | `{scope:per-file, ci:full}` | ✅ per-file | ✅ **full** | ✅ full |
| `js-lint-ci` (jscpd+knip), `rego`, `ga` | `full` | ❌ пропускається | ✅ full | ✅ full |

Спека: `docs/superpowers/specs/2026-06-14-lint-rule-consolidation.md`. Whole-tree механізми у локальному агенті **не запускаються** — це робота CI.
