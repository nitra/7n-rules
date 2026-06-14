---
session: 913990bf-de40-4a74-b536-d30012e981ab
captured: 2026-06-14T10:55:23+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/913990bf-de40-4a74-b536-d30012e981ab.jsonl
---

## ADR Уніфікація lint — дві ортогональні осі: scope + behavior

## Context and Problem Statement
Оркестратор `n-cursor lint` мав єдину вісь (`quick` → лише змінені файли / `ci` → весь репо), але не розрізняв «детект без мутацій» від «детект + автофікс». Тули з `--fix` (oxlint, eslint, stylelint, markdownlint, shellcheck, dotenv-linter) завжди мутували файли навіть у CI, де мутації неможливі.

## Considered Options
* Додати прапор `--read-only` / `--check` як третій ортогональний вимір поверх існуючої `quick|ci`-осі
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Дві незалежні осі: `scope` (per-file|full) × `behavior` (fix-by-default | --read-only)", because user підтвердив: default = дельта vs origin (`per-file`-правила), `--full` = весь репо; `--read-only` = нуль мутацій, нуль LLM, exit 1 на будь-якій знахідці, вивід лише «що не так»; `fix` = Tier0 (детермінований) → check-gate → Tier1+ (LLM omlx) → check-gate, exit 1 лише на невиправному залишку.

### Consequences
* Good, because CI = `--read-only --full` — інваріант «git diff байт-у-байт незмінний» тестується автоматично, жодних ненавмисних мутацій у pipeline.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `npm/scripts/lint-cli.mjs` (`runLint({full, readOnly})`), `npm/scripts/lib/rule-meta.mjs` (`parseRuleLintSpec`). Специфікації: `docs/specs/2026-06-14-lint-orchestrator-fix-readonly-unification-design.md`, `docs/superpowers/specs/2026-06-14-lint-rule-consolidation.md`.

---

## ADR Перейменування vocabulary scope: quick|ci → per-file|full + база-origin

## Context and Problem Statement
Значення `meta.json:lint` використовували терміни `quick` та `ci`, які змішували семантику scope (які файли лінтити) з контекстом виконання (агент vs CI). Потрібно було відокремити ці поняття й зробити дефолтний scope «дельта vs origin» замість «all files».

## Considered Options
* Перейменувати `quick`→`per-file`, `ci`→`full`; default = `collectChangedFilesSince(resolveChangedBase())`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`per-file` | `full` з базою-origin", because user підтвердив цю семантику в контексті canonізації у `docs/superpowers/specs/2026-06-14-lint-rule-consolidation.md`, де `per-file` = правило вміє декомпозуватись на changed-set, `full` = потрібен аналіз усього графа (jscpd, knip та ін.).

### Consequences
* Good, because transcript фіксує очікувану користь: назви відображають реальну семантику, а не контекст виконання; поле `ci` у meta.json скасовано — спрощується валідатор `checkLintField`.
* Bad, because breaking change у `meta.json` восьми правил (doc-files, ga, js-lint-ci, js-lint, rego, security, style-lint, text) — всі мають бути оновлені синхронно.

## More Information
Зачеплені файли: `npm/rules/*/meta.json` (8 штук), `npm/scripts/lib/rule-meta.mjs` (функція `parseRuleLintSpec`), `npm/rules/npm-module/js/rule_meta.mjs` (валідатор). Семантика security перекласифікована з `"ci"` на `"per-file"` (може лінтити по shard-у). Важкі full-only: ga, js-lint-ci, rego.

---

## ADR CI-контекст = --read-only --full (усунення окремого --ci і effectiveCi)

## Context and Problem Statement
У канонічній consolidation-спеці існував третій контекст B (`--ci`/`effectiveCi`), який міксував `scope.ci`-override з per-file-оптимізацією. Це створювало додатковий хелпер `effectiveCi` і поле `ci` в `meta.json`, які дублювали осі.

## Considered Options
* Схлопнути контекст B у `--read-only --full`: CI завжди запускає весь репо в режимі детект без мутацій
* Зберегти окремий прапор `--ci` зі своєю логікою
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "CI = `--read-only --full`", because user підтвердив (рішення R-2 + O-1): хелпер `effectiveCi`, прапор `--ci` і поле `meta.json:lint.ci` прибираються — CI ганяє весь репо в read-only, а per-file-оптимізація в CI не потрібна.

### Consequences
* Good, because transcript фіксує очікувану користь: дві незалежні осі замість трьох контекстів; GA-workflow = `n-cursor lint --read-only --full`; спрощується валідатор і `selectLintRules`.
* Bad, because втрата per-file-оптимізації в CI-режимі — великі монорепо ганяють весь граф навіть якщо змінився один файл.

## More Information
Amendment до `docs/superpowers/specs/2026-06-14-lint-rule-consolidation.md` (§2, §5, §8, §9, §10, §12). Семантика: `n-cursor lint` = дельта+fix, `n-cursor lint --read-only` = дельта+detect (pre-commit), `n-cursor lint --full` = весь+fix, `n-cursor lint --read-only --full` = весь+detect (CI).

---

## ADR Повне видалення n-cursor fix без аліасу; lint-fix-режим як заміна

## Context and Problem Statement
Існував окремий оркестратор `n-cursor fix` (convergence-loop + check-gate + Tier0→LLM) для конформності конфігів/файлів. З введенням fix-by-default у lint ці дві машини дублювали одне завдання, і постало питання: залишити `fix` як делегувальний аліас чи видалити повністю.

## Considered Options
* Видалити `n-cursor fix` повністю без аліасу; lint-fix-режим стає єдиним
* Залишити `fix` як deprecated делегувальний аліас до наступного major
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Повне видалення без аліасу", because user явно відхилив аліас («не потрібен цей аліас»); `fix`, `fix-t0`, `_fix-check` видаляються з bin разом із `skills/fix/`; convergence-loop/check-gate/Tier0 переноситься у `npm/rules/lint/js/` як движок fix-режиму lint.

### Consequences
* Good, because єдина точка входу через lint усуває плутанину між двома оркестраторами; CLAUDE.md і skills спрощуються.
* Bad, because breaking change — споживачі, що кличуть `n-cursor fix` напряму (PostToolUse-хук, скіл `/n-fix`, GA), мають бути перепідключені синхронно з видаленням.

## More Information
Цільовий контракт: `lint(files, cwd, { readOnly })` замінює `fix.mjs` + `check()` + policy. Файли до міграції: `npm/skills/fix/js/orchestrator.mjs` (224 рядки), `npm/skills/fix/js/t0.mjs`, 36× `npm/rules/*/js/fix.mjs`, `npm/scripts/post-tool-use-fix.mjs`, `.claude/settings.json` (PostToolUse hook). Задача-наступник (не в цій спеці): per-tool omlx-фіксери для detect-only тулів (knip, jscpd, trufflehog та ін.).

---

## ADR LLM-ескалація Tier1+: omlx замість хмарних моделей

## Context and Problem Statement
Існуючий `skills/fix/js/llm-worker.mjs` ескалював на хмарні Claude-моделі через `pi` CLI (haiku → sonnet). Нова специфікація вимагала локальних LLM для автофіксу (швидше, без latency хмари, без ліміту токенів).

## Considered Options
* Використовувати omlx (локальний MLX-сервер) або `mimo code` через наявний `lib/llm.mjs`; cloud — лише фолбек каскаду `resolveModel`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "omlx через `lib/llm.mjs` (`callOmlx`) з cloud-фолбеком", because user підтвердив: «замість хмарних використовуємо omlx (або прямі виклики або mimo code)»; `npm/lib/llm.mjs` вже маршрутизує `omlx/<model>` → прямий HTTP, а `npm/lib/models.mjs` → `resolveModel(tier)` → каскад local→cloud, тому cloud лишається як авто-фолбек.

### Consequences
* Good, because transcript фіксує очікувану користь: локальна ескалація без хмарної latency; `N_LOCAL_MIN_MODEL=omlx/...` у `~/.zshenv` є канонічним налаштуванням (пам'ять `docgen-omlx-model-local.md`).
* Bad, because локальна модель (16 GB RAM → лише e2b-варіанти) — якість автофіксу нижча за хмарну; cloud-фолбек = можлива непередбачувана затримка при відсутності omlx.

## More Information
Ключові файли: `npm/lib/llm.mjs` (`callOmlx`), `npm/lib/models.mjs` (`resolveModel`), `npm/skills/fix/js/llm-worker.mjs` (буде мігровано у `npm/rules/lint/js/`). Env-змінна: `N_LOCAL_MIN_MODEL`, `N_LOCAL_AVG_MODEL` (з `models.mjs` документації).

---

## ADR Зняття заборони паралельного eslint/oxlint

## Context and Problem Statement
`CLAUDE.md` і `scripts.mdc` забороняли запуск кількох eslint/oxlint процесів паралельно (перевантаження диску/CPU). Нова lint-архітектура розбиває файловий набір на disjoint shard-и між правилами.

## Considered Options
* Зняти заборону для паралельних запусків по диз'юнктних shard-ах файлів
* Залишити глобальну заборону
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Паралельний запуск дозволено для диз'юнктних shard-ів", because user підтвердив: «заборону паралельного eslint/oxlint знімаємо це обмеження (бо на паралельні запуски по різним файлам це ок)».

### Consequences
* Good, because швидший lint на великих репо — правила js-lint і js-lint-ci можуть паралельно обробляти свої набори файлів.
* Bad, because якщо shard-и перетинаються (наприклад, обидва правила фільтрують ті самі `.mjs`), заборона повертається де-факто — треба перевіряти диз'юнктність у `selectLintRules`.

## More Information
Обов'язковий крок major-міграції: оновити `CLAUDE.md` і `.cursor/rules/scripts.mdc` — замінити безумовну заборону на «паралельно ОК лише для disjoint shard-ів». Зафіксовано у плані `docs/specs/2026-06-14-lint-orchestrator-fix-readonly-unification-design.md` (крок 6).
