---
session: 4b386ce5-70e3-4c5a-b5f6-bcdd5aef68ed
captured: 2026-06-14T06:59:07+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/4b386ce5-70e3-4c5a-b5f6-bcdd5aef68ed.jsonl
---

## ADR lint-doc: суворість CI — повний stale-детект (Variant 1)

## Context and Problem Statement
У PR `claude/quirky-lederberg-4306d8` запроваджувався новий механізм `lint-doc` для перевірки актуальності документації кодових файлів. Потрібно було визначити, чи падатиме CI лише на відсутні доки (`--missing-only`), чи також на застарілі (CRC-mismatch).

## Considered Options
* Варіант 1 — повний stale-детект: `stale = missing ∪ crc-mismatch`; CI падає при відсутності доки або коли `crc(джерело) ≠ crc` у frontmatter доки
* Варіант 2 — `--missing-only`: CI падає лише на відсутні доки; CRC-mismatch толерується

## Decision Outcome
Chosen option: "Варіант 1 — повний stale-детект", because `--missing-only` залишає головну діру відкритою — застарілі доки тихо розсинхронізовуються з кодом; CI має бути строгим, щоб будь-яка зміна джерела без перегенерації доки ловилась у PR.

### Consequences
* Good, because transcript фіксує очікувану користь: будь-яка правка джерела без `fix-doc` → червоний CI; дока ніколи мовчки не «протухає».
* Bad, because кожна правка джерела вимагає локального прогону `fix-doc` (генерація local-only через omlx) і коміту оновленої доки перед пушем.

## More Information
Передумова (Крок 0): перед увімкненням CI прогнати `fix-doc` до зеленого стану. `--missing-only` лишається як опція команди, але не як режим CI. Файл спеки: `docs/superpowers/specs/2026-06-12-doc-files-lint-doc-fix-doc-split.md`.

---

## ADR lint-doc: дефолт — changed-vs-origin, `--full` — повний прогін

## Context and Problem Statement
Для `lint-doc` треба було вирішити, що є дефолтним режимом: перевірка всього репо або лише змінених файлів. Також потрібна була єдина семантика бази порівняння, яку могли б використовувати і локальні агенти, і CI.

## Considered Options
* `lint-doc` без аргументів — повний скан репо; `lint-doc --since <ref>` — по delta
* `lint-doc` без аргументів — changed-vs-origin (delta); `lint-doc --full` — повний скан

## Decision Outcome
Chosen option: "`lint-doc` без аргументів — changed-vs-origin", because локальний агент та CI потребують одного й того самого примітива: перевірити лише те, що змінилося відносно origin. Повний скан (`--full`) — явний вибір на вимогу чи локальний baseline.

### Consequences
* Good, because один виклик `lint-doc` обслуговує і агента з некомітнутими правками, і CI (`git diff --name-only --merge-base <base>` включає working tree справа).
* Bad, because якщо `@{upstream}` не резолвиться (detached HEAD / гілка не запушена) — `lint-doc` fail-closed падає на `--full`, що може здивувати.

## More Information
База резолвиться: `@{upstream}` → `origin/HEAD` → fallback `--full`. Реалізується через вже наявні `resolveChangedBase()` і `collectChangedFilesSince(base)` з `npm/scripts/lib/changed-files.mjs`. Семантика `git diff --merge-base <ref>`: diff від `merge-base(<ref>, HEAD)` до working tree — покриває і закомічені на гілці зміни, і staged/unstaged. `--merge-base` гарантує, що рахуються лише «свої» зміни, не чужі з `origin/main`. Наявний `--git` (vs `HEAD`) стає підвидом `--since HEAD` і лишається для Stop-гейта з `exit 2`.

---

## ADR meta.json:lint — нова схема класифікації per-file / full

## Context and Problem Statement
Поточне поле `meta.json:lint` у правилах (`"quick"` / `"ci"`) змішувало дві різні ознаки: здатність детектора дробитися на окремі файли та контекст виконання. Потрібна була єдина стандартизована класифікація для всіх lint-механізмів, яку б споживали оркестратор `n-cursor lint`, GA-workflow і документація.

## Considered Options
* Зберегти `"quick"|"ci"` та додати окремий `meta.json`-ключ для CI-override
* Нова схема `{scope: "per-file"|"full", ci?: "full"}` зі string-shortcut

## Decision Outcome
Chosen option: "Нова схема `{scope, ci}`", because вона явно розділяє «здатність детектора» (`scope`) і «поведінку в CI» (`ci`); shortcut-рядки `"per-file"` / `"full"` не ламають читабельності малих правил.

### Consequences
* Good, because transcript фіксує очікувану користь: оркестратор може без умов деривувати три контексти (агент/CI/full) з одного джерела, без YAML-логіки.
* Bad, because hard-rename `quick|ci` → `{scope,ci}`: треба мігрувати всі `meta.json` одним кроком і оновити `parseRuleLintPhase` + `rule_meta.mjs:checkLintField` у `npm/scripts/lib/rule-meta.mjs` та `npm/rules/npm-module/js/rule_meta.mjs`.

## More Information
Класифікація всіх 8 механізмів, узгоджена в transcript:

| rule | `lint` | обґрунтування |
|---|---|---|
| `js-lint`, `style-lint`, `doc`, `text` | `"per-file"` | per-document детект |
| `security` (trufflehog) | `{scope:"per-file", ci:"full"}` | per-file локально, full в CI (defense-in-depth) |
| `js-lint-ci` (jscpd+knip) | `"full"` | jscpd шукає дублі між файлами; knip будує повний граф |
| `rego` | `"full"` | `opa check --strict` — крос-модульна компіляція |
| `ga` | `"full"` | крос-файлові JS-перевірки + мізерний корпус |

`text` (cspell, markdownlint, shellcheck, dotenv-linter, v8r) підтверджено per-document з аналізу `text/lint/lint.mjs` — жодного крос-файлового кроку. Схему зафіксовано в спеці `docs/superpowers/specs/2026-06-14-lint-rule-consolidation.md`, яку написано на гілці `claude/quirky-lederberg-4306d8`. Нове правило-оркестратор — `npm/rules/lint/`; детектори лишаються у власних каталогах.

---

## ADR три контексти виконання lint

## Context and Problem Statement
Різні виклики lint (локальний агент під час роботи, GA CI, ручний повний аудит) потребували різної поведінки, але раніше ця різниця не була кодифікована ні в `meta.json`, ні в документації.

## Considered Options
* Три окремі npm-скрипти/команди без спільного контракту
* Один оркестратор, що деривує поведінку з `meta.json:lint.scope` та `lint.ci` залежно від переданого контексту

## Decision Outcome
Chosen option: "Один оркестратор з деривацією з `meta.json`", because уся логіка «хто що запускає» лишається в одному тестованому місці CLI, а не розмазується по YAML і скриптах.

### Consequences
* Good, because transcript фіксує очікувану користь: агент викликає `lint-doc` (без аргументів) і отримує рівно своє changed-vs-origin; CI викликає `lint-doc --since $BASE` і `--full`-механізми запускаються автоматично.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Три контексти (§5 спеки `2026-06-14-lint-rule-consolidation.md`):
- **A · Локальний агент** (`n-cursor lint`, дефолт): тільки `scope==="per-file"` → `lint(changedVsOrigin)`; whole-tree механізми не запускаються.
- **B · CI** (`n-cursor lint --ci` / GA): всі механізми; `effectiveCi = rule.ci ?? rule.scope`; `security` і `full`-механізми — повні.
- **C · Повний аудит** (`--full`): все повним прогоном, на вимогу чи перед релізом.
