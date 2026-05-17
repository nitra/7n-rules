# Правило adr для автоматичного розгортання механізму capture-decisions

**Status:** Accepted
**Date:** 2026-05-07

## Контекст

У проєкті `@nitra/cursor` вже існував локальний Stop-хук `.claude/hooks/capture-decisions.sh`, що витягує ADR/Runbook/Knowledge-чернетки з транскриптів Claude Code. Механізм не мав способу тиражуватись у нові проєкти через систему правил пакета.

## Рішення/Процедура/Факт

- Додано `npm/mdc/adr.mdc` — нове правило з ручним вмиканням через `rules: ["adr"]` у `.n-cursor.json` (навмисно відсутнє в `auto-rules.md`).
- Канонічний скрипт перенесено в `npm/.claude-template/hooks/capture-decisions.sh` з fallback-логікою: якщо `claude` CLI недоступний, використовується `cursor-agent` (`-p --mode ask --output-format text`); моделі конфігуруються через `CAPTURE_DECISIONS_CLAUDE_MODEL` і `CAPTURE_DECISIONS_CURSOR_MODEL`.
- `npm/scripts/sync-claude-config.mjs` оновлено: при `rules` що містить `"adr"` — копіює скрипт у `.claude/hooks/` і додає managed Stop-групу до `.claude/settings.json`; при видаленні `"adr"` — прибирає managed-групу.
- ADR Stop-хук перемістився з `.claude/settings.local.json` до `.claude/settings.json` (project-shared).
- `npm/scripts/check-adr.mjs` — 5 перевірок: байт-збіг скрипта з канонічним, наявність ADR-групи в `settings.json`, відсутність дубля в `.local.json`, покриття `.gitignore` для лог-файлу, наявність LLM CLI.
- Тести: `npm/tests/check-adr.test.mjs` (7 кейсів), 5 нових кейсів у `sync-claude-config.test.mjs`. Версія: 1.8.189.

## Обґрунтування

Правило вмикається вручну, оскільки ADR-ведення є усвідомленим вибором, а не технічною вимогою стека. Fallback на `cursor-agent` усуває залежність від конкретного CLI. Hook у project-shared `settings.json` дозволяє всій команді бачити інфраструктуру без ручного кроку на кожній машині.

## Розглянуті альтернативи

- Залишити hook у `.claude/settings.local.json` — відхилено: новим учасникам треба було б вручну копіювати.
- Додати в `auto-rules.md` — відхилено: ADR-ведення є усвідомленим вибором.
- Перевіряти лише `claude` CLI без fallback — відхилено: `cursor-agent` рівноправна альтернатива.

## Зачіпає

`npm/mdc/adr.mdc`, `npm/.claude-template/hooks/capture-decisions.sh`, `npm/scripts/check-adr.mjs` (новий), `npm/scripts/sync-claude-config.mjs`, `npm/bin/n-cursor.js`, `npm/tests/check-adr.test.mjs` (новий), `npm/tests/sync-claude-config.test.mjs`, `.n-cursor.json`, `.claude/settings.json`, `.claude/settings.local.json`, `npm/package.json` (v1.8.189), `npm/CHANGELOG.md`.

## Update 2026-05-15

Поля YAML-frontmatter у чернетках `docs/adr/_inbox/<timestamp>-<session>.md` є *провенансом* і додаються хуком `capture-decisions.sh` перед записом LLM-відповіді у файл:

- `session` — повний UUID сесії Claude Code, яка породила чернетку.
- `captured` — момент запису у форматі ISO-8601; дозволяє впорядковувати чернетки в часі незалежно від `git log`.
- `transcript` — абсолютний шлях до JSONL-файлу транскрипту (`~/.claude/projects/…/<session-id>.jsonl`); дає змогу повернутися до повного `thinking`/tool-логу сесії для перевірки точності артефакту чи відновлення контексту під час ревізії `_inbox`.

## Update 2026-05-15

Призначення службових полів frontmatter у чернетках. `capture-decisions.sh` (рядки 150–151) записує три поля:

- `session` — ID сесії Claude Code; перші 8 символів дублюються в імені файлу для зіставлення чернетки з конкретним діалогом серед десятків у `_inbox/`.
- `captured` — час запуску Stop-hook; дозволяє при перегляді inbox відрізнити свіже від застарілого.
- `transcript` — абсолютний шлях до JSONL-файлу в `~/.claude/projects/.../`; аудит-стежка для перевірки точності переказу моделі.

Ці поля є «корінцем чернетки» і не переносяться при промоції в постійний ADR-файл. Станом на 2026-05-15 у `docs/adr/_inbox/` накопичилося 156 чернеток; поза inbox у `docs/adr/` — порожньо. Процес промоції залишається ручним: перегляд inbox, видалення зайвого, редагування, видалення frontmatter, переміщення у постійне місце.

## Update 2026-05-15

### Семантика frontmatter у чернетках `_inbox`

Кожен файл у `docs/adr/_inbox/` містить frontmatter із полями `session`, `captured`, `transcript`. Stop-hook `capture-decisions.sh` пише їх автоматично — це службовий «корінець» чернетки, не частина ADR-змісту.

- `session` — ID сесії Claude Code (перші 8 символів збігаються з іменем файлу).
- `captured` — час зупинки Stop-hook; дозволяє відрізнити свіже від давнього.
- `transcript` — абсолютний шлях до JSONL-файлу `~/.claude/projects/...<session>.jsonl` (аудит-стежка для уточнення чернетки).

При промоції в постійний ADR frontmatter **не переноситься**: у фінальному файлі залишається лише вміст зі статусом і датою. Службові поля потрібні виключно для прив'язки чернетки до джерела-сирця.

**Зачіпає:** `npm/.claude-template/hooks/capture-decisions.sh:147–151`, `docs/adr/_inbox/*.md`
