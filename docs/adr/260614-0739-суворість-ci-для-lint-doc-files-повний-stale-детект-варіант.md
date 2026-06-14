---
session: 4b386ce5-70e3-4c5a-b5f6-bcdd5aef68ed
captured: 2026-06-14T07:39:03+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/4b386ce5-70e3-4c5a-b5f6-bcdd5aef68ed.jsonl
---

I'll analyze this transcript and produce MADR-style decision records.

## ADR Суворість CI для lint-doc-files: повний stale-детект (Варіант 1)

## Context and Problem Statement
Спека міграції `doc-files → lint-doc / fix-doc` (`docs/superpowers/specs/2026-06-12-doc-files-lint-doc-fix-doc-split.md`) передбачала CI-перевірку застарілості файлових документів. Постало питання, якою має бути суворість детектора в CI: перевіряти лише відсутні доки (`missing`) чи також застарілі за CRC (`crc-mismatch`).

## Considered Options
* Варіант 1 — повний stale-детект (`missing ∪ crc-mismatch`): CI падає при відсутній АБО застарілій доці
* Варіант 2 — `--missing-only`: CI падає лише при відсутній доці, `crc-mismatch` толерується

## Decision Outcome
Chosen option: "Варіант 1 — повний stale-детект", because головна мета механізму — щоб дока не відставала від коду; `--missing-only` лишає головну діру (застарілі доки) відкритою; `--missing-only` залишається доступним як параметр команди, але не як режим CI.

### Consequences
* Good, because будь-яка зміна кодового файлу без перегенерації доки ловиться в PR — дока ніколи мовчки не «протухає».
* Bad, because кожна правка джерела вимагає прогнати `fix-doc-files` і закомітити оновлену доку, інакше CI червоний.

## More Information
Команда `lint-doc-files` (exit 1 на stale); спека §6, п.4: «CI має бути строгим»; Крок 0 спеки — перед увімкненням CI прогнати `fix-doc-files` до зеленого стану.

---

## ADR Дефолтна база lint-doc-files: changed-vs-origin (інверсія дефолту)

## Context and Problem Statement
Механізм `lint-doc-files` мав працювати лише по змінених файлах, щоб і локальні агенти, і CI не запускали повний скан при кожній зміні. Потрібно було визначити семантику «за замовчуванням» і надати єдину команду для всіх контекстів (агент, CI, hook).

## Considered Options
* Дефолт — changed-vs-origin (merge-base), `--full` для повного скану
* Дефолт — повний скан, `--since <ref>` для часткового
* `--missing-only` як режим CI (Варіант 2, відкинутий у попередньому рішенні)

## Decision Outcome
Chosen option: "Дефолт — changed-vs-origin, `--full` для повного скану", because локальний агент і CI мають одну й ту саму команду без параметрів (`lint-doc-files`); «changed» означає одне скрізь — diff merge-base vs `@{upstream}` / `origin/HEAD` через `resolveChangedBase()`/`collectChangedFilesSince()` (вже наявні у `npm/scripts/lib/changed-files.mjs`); повний скан лишається локальним на вимогу.

### Consequences
* Good, because єдина семантика для агента, CI, hook — без розгалужень у коді; перевикористання `changed-files.mjs`, що вже споживає `coverage --changed`.
* Bad, because якщо `@{upstream}` не резолвиться (detached / гілка не пушена), `lint-doc-files` автоматично падає на `--full` — безпечна поведінка, але може бути несподіваною.

## More Information
Файл `npm/scripts/lib/changed-files.mjs`: `resolveChangedBase()`, `collectChangedFilesSince(base)`; три контексти виклику: локальний агент → `lint-doc-files`, CI PR → `lint-doc-files --since origin/${{ github.base_ref }}`, CI push → `lint-doc-files --since $LAST_GREEN`; hook Stop-гейт → `lint-doc-files --git`.

---

## ADR Класифікація lint-механізмів: per-file vs full у meta.json

## Context and Problem Statement
Монорепо має вісім lint-механізмів різної природи. Агрегатор `n-cursor lint` мав один вимір `meta.json:lint` (`quick`|`ci`), який змішував здатність детектора дробитися на файли (per-file/whole-tree) з контекстом запуску. Потрібно було розділити ці два виміри і стандартизувати поведінку в трьох контекстах: локальний агент, CI, повний аудит.

## Considered Options
* Новий `{scope, ci}` у `meta.json` + шорткати `"per-file"`/`"full"` (обраний)
* Лишити `quick`|`ci` без змін, регулювати поведінку в YAML-воркфлоу
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`{scope, ci}` у `meta.json`", because це розділяє два ортогональних виміри: `scope` — чи детектор технічно дробиться, `ci` — override режиму в CI (дефолт = `scope`); поведінка трьох контекстів виводиться автоматично без додаткових полів.

### Consequences
* Good, because transcript фіксує очікувану користь: локальний агент запускає лише per-file-здатні механізми (швидко), CI запускає всі з коректним режимом для кожного, `--full` завжди дає повний аудит.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Класифікація всіх восьми механізмів: `js-lint`, `style-lint`, `doc-files`, `text` → `"per-file"`; `security` → `{scope:"per-file", ci:"full"}`; `js-lint-ci` (jscpd+knip), `rego`, `ga` → `"full"`. Спека `docs/superpowers/specs/2026-06-14-lint-rule-consolidation.md`, §4 (таблиця) і §5 (деривація контекстів). Валідатор `npm/scripts/lib/rule-meta.mjs`: `parseRuleLintPhase` має бути розширений для нового формату.

---

## ADR Домівка правила doc-files: npm/rules/doc-files (не skill)

## Context and Problem Statement
Код детектора застарілості (`docgen-scan.mjs`, `docgen-crc.mjs` тощо) жив у `npm/skills/doc-files/js/`. Потрібно було розмістити новий lint-механізм у правильній категорії репо: правило (`npm/rules/<id>/`) — детермінований checkable-механізм з policy/rego, скіл (`npm/skills/<id>/`) — агентський workflow.

## Considered Options
* Перенести `js/` у `npm/rules/doc-files/`, лишити тонкий скіл `npm/skills/doc-files/` (обраний)
* Зробити `doc-files` виключно скілом (без правила `doc`) — прибрати policy-канал (GA-workflow, package.json-скрипт)

## Decision Outcome
Chosen option: "Правило `npm/rules/doc-files/` + тонкий скіл `npm/skills/doc-files/`", because детермінований детектор застарілості відповідає природі правила (`scripts.mdc`), а агентський workflow (`fix-doc-files` через LLM) лишається тонким скілом поверх нього.

### Consequences
* Good, because transcript фіксує очікувану користь: policy-канал (GA-workflow, package.json-скрипт, rego) доступний лише через правило; code modules (`docgen-scan.mjs` тощо) тепер живуть у canonical-місці.
* Bad, because `git mv npm/skills/doc-files/js → npm/rules/doc-files/js` вимагав виправлення re-export-шляху в `npm/skills/doc-aggregate/js/docgen-ignore.mjs` і всіх маркерів у `sync-claude-config.mjs` / `.claude-template/settings.template.json`.

## More Information
`git mv npm/skills/doc-files/js npm/rules/doc-files/js`; виправлено `npm/skills/doc-aggregate/js/docgen-ignore.mjs` (шлях re-export); `DOC_FILES_HOOK_COMMAND_MARKER` у `npm/scripts/sync-claude-config.mjs` оновлено з `@nitra/cursor doc-files check` на `@nitra/cursor lint-doc-files`; `.claude-template/settings.template.json` — команди hook оновлено на `lint-doc-files --hook` / `lint-doc-files --git`; нові файли: `npm/rules/doc-files/fix.mjs`, `npm/rules/doc-files/meta.json`, `npm/rules/doc-files/js/lint.mjs`, `npm/rules/doc-files/lint/lint.mjs`, `npm/rules/doc-files/doc-files.mdc`.
