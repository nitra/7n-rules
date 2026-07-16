---
description: Автоматичний збір ADR/Runbook/Knowledge-чернеток і батч-нормалізація у `docs/adr/` через Stop-хуки Claude Code та Cursor Agent
alwaysApply: true
version: '2.2'
---

Правило `adr` автоматично фіксує архітектурні рішення (ADR) після кожної сесії через Stop-хуки і батч-нормалізує чернетки у канонічний формат MADR v4.

## Stop-hook у `.claude/settings.json`

Канонічний запис, який вставляє sync (поряд із PostToolUse fix-хуком — той живе в іншій події, тут не показаний):

```json title=".claude/settings.json"
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/capture-decisions.sh\"",
            "async": true,
            "timeout": 180
          }
        ]
      },
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/normalize-decisions.sh\"",
            "async": true,
            "timeout": 600
          }
        ]
      }
    ]
  }
}
```

Обидві ADR-групи ідентифікуються пакетом за маркером у `command` (`.claude/hooks/capture-decisions.sh`, `.claude/hooks/normalize-decisions.sh`) — користувацькі hook-групи поряд не чіпаються. Якщо `adr` прибрати з `rules`, обидві ADR-групи автоматично видаляються на наступному `npx @7n/rules`.

## Stop-hook у `.cursor/hooks.json`

Cursor Agent читає project-level **`.cursor/hooks.json`**. `npx @7n/rules` merge-ить файл: користувацькі hooks лишаються, managed entries для `capture-decisions.sh` і `normalize-decisions.sh` перезаписуються або видаляються разом із правилом `adr`.

```json title=".cursor/hooks.json"
{
  "version": 1,
  "hooks": {
    "stop": [
      {
        "command": "bash -lc 'root=\"$PWD\"; if [ ! -f \"$root/.claude/hooks/capture-decisions.sh\" ] && [ -f \"$root/../.claude/hooks/capture-decisions.sh\" ]; then root=\"$root/..\"; fi; bash \"$root/.claude/hooks/capture-decisions.sh\"'",
        "timeout": 180
      },
      {
        "command": "bash -lc 'root=\"$PWD\"; if [ ! -f \"$root/.claude/hooks/normalize-decisions.sh\" ] && [ -f \"$root/../.claude/hooks/normalize-decisions.sh\" ]; then root=\"$root/..\"; fi; bash \"$root/.claude/hooks/normalize-decisions.sh\"'",
        "timeout": 600
      }
    ]
  }
}
```

Обидва Stop-hook'и ADR живуть у **project-shared** `.claude/settings.json` (закомічений), щоб механізм працював у всіх членів команди. Якщо хук колись був у `.claude/settings.local.json` — прибери дубль вручну: project-shared і local-копія створили б два запуски на одну подію.

## ADR_HOOKS_SKIP — оркестраторні сесії не потрапляють у ADR hooks

Підкоманди-оркестратори (`npx @7n/rules lint`, `/n-lint`, `/n-doc-files`, `/n-taze`, `/n-release` тощо) можуть спавнити внутрішню agent/LLM-сесію. Такий транскрипт — технічний шум, не людська думка, тому JS-оркестратор (`npm/bin/n-rules.js`) виставляє `ADR_HOOKS_SKIP=1` перед `switch (command)`, до будь-якого дочірнього процесу. `capture-decisions.sh`, `normalize-decisions.sh` і `pi`-extension (`n-rules-adr`) перевіряють прапор одразу після власних recursion guards і мовчки виходять (`exit 0` / `return`) — без запису в лог.

## Capture-бекенд: `CAPTURE_DECISIONS_BACKEND`

`capture-decisions.sh` вибирає LLM-бекенд через env-селектор (дефолт `pi`):

| Значення | Поведінка |
| --- | --- |
| `pi` (дефолт) | Тільки локальний `pi` (npm-first lookup: root `.bin`, nested `@7n/rules` `.bin`, `PATH`); без бінарника або без моделі (`CAPTURE_DECISIONS_PI_MODEL`/`N_LOCAL_MIN_MODEL`) — мовчки `exit 0`, без cloud-фолбеку |
| `claude` | Примусово `claude -p --model "$CAPTURE_DECISIONS_CLAUDE_MODEL"` |
| `cursor-agent` | Примусово `cursor-agent -p --mode ask --model "$CAPTURE_DECISIONS_CURSOR_MODEL"` |
| `auto` | Каскад за доступністю: `pi` -> `claude` -> `cursor-agent` -> skip (не за результатом виклику — порожня відповідь обраного бекенду фінальна) |

Дефолт `pi` тримає capture локальним і безкоштовним; cloud вмикається лише свідомим `CAPTURE_DECISIONS_BACKEND=auto` (або `claude`/`cursor-agent`). Виклик `pi` герметичний і офлайн: `--no-session --mode text --no-tools --no-context-files --no-extensions --no-skills --no-prompt-templates --offline`.

## Швидкий gate через conftest

| Namespace | Файл | Що перевіряє |
| --- | --- | --- |
| `adr.settings_json` | `.claude/settings.json` | Наявність обох Stop-хуків у `hooks.Stop[]` |
| `adr.settings_local_json` | `.claude/settings.local.json` | Відсутність дублів Stop-хуків у local-файлі |

## JS-перевірки хуків і конфігурації (`hooks.mjs`)

`js/hooks.mjs` перевіряє відповідність проєкту правилу `adr` через шість незалежних перевірок:

### 1. Канонічність скриптів хуків

Для кожного з двох bash-скриптів (`capture-decisions.sh`, `normalize-decisions.sh`) перевіряє:

- файл `.claude/hooks/<script>.sh` **існує** у проєкті;
- його вміст **ідентичний** bundled-версії з пакета `@7n/rules`.

Якщо файл відсутній або відрізняється — `fail` з підказкою `npx @7n/rules`.

### 2. Наявність `.claude/settings.json`

Перевіряє **існування** project-shared файлу `.claude/settings.json`. Структуру хуків всередині (наявність `hooks.Stop[]` з відповідними маркерами) валідує окрема Rego-полісі `adr.settings_json`.

### 3. Cursor hooks config

Читає `.cursor/hooks.json` і перевіряє, чи кожен зі скриптів (`capture-decisions.sh`, `normalize-decisions.sh`) присутній у `hooks.stop[*].command` як підрядок-маркер.

### 4. `.gitignore` для лог-файлів хуків

Перевіряє, чи покриває `.gitignore` лог-файли `.claude/hooks/capture-decisions.log` і `.claude/hooks/normalize-decisions.log`. Допустимі форми покриття:

- точний шлях (`.claude/hooks/capture-decisions.log`)
- glob `.claude/hooks/*.log` або `.claude/hooks/**/*.log`
- широкий glob `*.log` або `**/*.log`

### 5. Доступність capture-бекенду

Інформативна (завжди `pass`) перевірка стану дефолтного бекенду `pi` — npm-first пошук бінарника (root `node_modules/.bin/pi`, nested `node_modules/@7n/rules/node_modules/.bin/pi`, system `PATH`) і наявність локальної моделі (`CAPTURE_DECISIONS_PI_MODEL` або `N_LOCAL_MIN_MODEL`) — разом зі станом cloud-фолбеку `claude`/`cursor-agent`, доступного через `CAPTURE_DECISIONS_BACKEND=claude|cursor-agent|auto`. Якщо жоден бекенд не готовий — хук просто мовчки no-op'ає, тому це попередження, а не помилка.

## MADR v4 і дві фази файлу

ADR живуть у єдиному каталозі **`docs/adr/`**. Clean ADR-и мають формат **MADR v4.0.0 minimal** з **OKF v0.1 frontmatter** і точними section headings англійською:

- `## Context and Problem Statement`
- `## Considered Options`
- `## Decision Outcome`
- `### Consequences`
- `## More Information`

Вміст секцій — українською, code identifiers / paths / commands — як у transcript. Якщо transcript не містить альтернатив або підтверджених наслідків, LLM-промпт нормалізатора вимагає явно писати `Інші варіанти в transcript не обговорювалися.` або `transcript не містить підтвердження ...`, а не вигадувати відсутні факти.

Є два стани файлу, які відрізняються YAML frontmatter:

- **Draft** — файл з frontmatter `session: …`, `captured: …`, `transcript: …` та timestamp-іменем `YYMMDD-HHMM-<sid>.md` (fallback на старі чернетки без розпізнаного heading). Пише `capture-decisions.sh` після кожної сесії.
- **Clean** — файл з OKF v0.1 frontmatter (`type: ADR`, `title:`, `description:`) і kebab-case-іменем. Заголовок `#` у тілі не потрібен — `title:` у frontmatter вже є заголовком. `normalize-decisions.sh` зберігає timestamp-префікс чернетки → `YYMMDD-HHMM-<slug>.md` (наприклад `260518-0928-ланцюжок-запуску-abie.md`); підтримуються і старіші чернетки з `YYYYMMDD-HHMMSS-` prefix. Створений руками clean-файл може мати просто `<slug>.md`.

`normalize-decisions.sh` ніколи не чіпає clean-файли — крім випадку `merge-into`, коли дописує `## Update YYYY-MM-DD` в кінець наявного clean-файлу.

**Примітка про історичні файли:** описаний тут MADR v4 minimal — конвенція для файлів, які проходять актуальну версію `normalize-decisions.sh`. Каталог `docs/adr/` цього ж репозиторію містить і файли зі старішими форматами frontmatter/заголовків (напр. `type: ADR` + `topic:`/`spec:` без `title:`, чи заголовки українською на кшталт «Контекст»/«Рішення»), накопичені до впровадження поточної конвенції. Тому автоматизованої перевірки форми clean-ADR тут немає — рекурсивна класифікація "старий/новий формат" по вмісту ненадійна, а lint по всіх файлах масово провалював би легітимні історичні записи.

## Фаза 1 — Capture

Stop-hook `capture-decisions.sh` зчитує JSONL-транскрипт сесії (через `jq`), витягає текст, `thinking`-блоки та назви `tool_use`-викликів, передає компактний дайджест у LLM-бекенд з evidence-bound промптом і записує результат у **`docs/adr/<timestamp>-<slug-або-sid>.md`**, якщо модель повернула MADR-блок з шапкою `## ...`. Якщо модель повернула `NONE` (тривіальна сесія) або відповідь порожня — нічого не пишеться. Slug для імені файлу виводиться локально (без додаткового LLM-виклику) з першого `## `-заголовка відповіді. Рекурсію з внутрішнього виклику моделі блокує env-var `CAPTURE_DECISIONS_RUNNING=1`.

Для Cursor payload скрипт бере `transcript_path`, `conversation_id` / `generation_id` і `workspace_roots[0]`; для Claude Code — `transcript_path`, `session_id` і `CLAUDE_PROJECT_DIR`.

Вибір LLM-бекенду для Capture (`CAPTURE_DECISIONS_BACKEND`, дефолт `pi`) описаний окремо в `adr/main.mdc` ("Capture-бекенд"), тут не дублюється.

**Cross-project skip:** якщо в сесії редагувалися файли, але жоден не під поточним `PROJECT_ROOT` — це паралельна робота в іншому проєкті, і ADR-чернетка не пишеться (сесії без жодних редагувань, тобто чисте Q&A, цей гейт не відкидає). Вимикається `ADR_CAPTURE_SKIP_CROSS_PROJECT=0`.

**Tooling-only skip:** перед викликом LLM `capture-decisions.sh` дивиться у transcript на `tool_use`-правки (`Edit`/`Write`/`MultiEdit`). Якщо всі змінені файли потрапляють у вузький allowlist — `.cspell.json`, `docs/adr/*.md`, `CHANGELOG.md` (в тому числі вкладений `*/CHANGELOG.md`), кореневі `AGENTS.md`/`CLAUDE.md`, або `package.json` з diff виключно по ключу `"version"` — хук виходить з `exit 0` без LLM-виклику. Це розриває петлю «`/n-lint` править `.cspell.json` → з'являється новий ADR-draft → наступний `/n-lint` знов псує правопис у цьому draft». Поведінку вимикає `ADR_NORMALIZE_SKIP_TOOLING_ONLY=0` (той самий прапор ділять capture і normalize).

## Фаза 2 — Normalize

Stop-hook `normalize-decisions.sh` спрацьовує на тій самій `Stop`-події, але:

- Виходить миттєво, якщо чернеток (`session:` у frontmatter) менше ніж **`ADR_NORMALIZE_THRESHOLD`** (default 30).
- Виходить миттєво, якщо від попередньої спроби пройшло менше **`ADR_NORMALIZE_MIN_INTERVAL_HOURS`** годин (default 6) — щоб не крутитися щоразу, коли поріг постійний.
- Бере не більше **`ADR_NORMALIZE_BATCH`** чернеток (default 10, найстарші за іменем-timestamp), формує один промпт LLM і чекає JSON-відповідь зі списком операцій.
- Виходить миттєво, якщо репозиторій у стані `MERGE_HEAD` / `CHERRY_PICK_HEAD` / `REVERT_HEAD` / `rebase-apply` / `rebase-merge` — небезпечно правити файли посеред конфлікту чи rebase.
- Виходить миттєво, якщо інший normalize-запуск тримає `flock` на `.claude/hooks/.normalize.lock` (тільки де `flock` доступний — macOS без нього просто не блокує паралельний запуск).
- Перед викликом LLM для кожної чернетки batch'а читає `transcript:` із frontmatter і той самий tool_use-список. Чернетки tooling-only — видаляє без виклику LLM. Якщо після фільтра batch порожній — `exit 0`.

LLM повертає масив операцій:

| `op` | Семантика | Поля |
| --- | --- | --- |
| `delete` | Чернетка тривіальна / повністю покрита іншим clean-ADR-ом. | `file`, `reason` |
| `rewrite` | Чернетка стає окремим clean-файлом MADR v4 minimal: draft-frontmatter (`session:`/`captured:`/`transcript:`) заміняється на OKF v0.1 (`type: ADR`, `title:`), ім'я → `<timestamp>-<slug>.md` (timestamp-префікс чернетки збережено), додаються `**Status:** Accepted`, `**Date:**` з `captured` і canonical MADR headings. Якщо LLM не повернула OKF frontmatter, скрипт сам дописує мінімальне (`type: ADR`, `title:` з першого `# `-рядка або зі `slug`). | `file`, `slug`, `content` |
| `merge-into` | Чернетка повторює тему вже існуючого clean-файлу; дописуємо `## Update YYYY-MM-DD` у кінець `target`. Скрипт резолвить `target` у три кроки: точна назва в `docs/adr/`, slug свіжо створеного `rewrite` цього ж батчу, або унікальний існуючий файл, що закінчується на `-<slug>.md`. | `file`, `target`, `additions` |

`slug` — kebab-case українською (`ланцюжок-запуску-abie`, `npm-publish-flow`); англійські технічні терміни лишаються англійською без транслітерації. До імені clean-файлу скрипт додає `YYMMDD-HHMM-` чернетки, тож запис лишається прив'язаним до часу capture, а `docs/adr/` сортується хронологічно. Колізія імен обробляється детермінованим суфіксом `-2`, `-3`. Старі чернетки з `YYYYMMDD-HHMMSS-` prefix нормалізатор також розпізнає, щоб не ламати наявний inbox.

### Жодних git-операцій

`normalize-decisions.sh` **не комітить, не `git add`, нічого з git**. Усі зміни — у робочому дереві. Розробник у зручний момент дивиться `git status` / `git diff` і вирішує: `git add` + commit, `git checkout -- <file>` для відкату, або правки руками. Це і є review-вікно.

### Recursion guard і ENV-керування

Інший LLM-виклик, який запустить normalize, успадковує `ADR_NORMALIZE_RUNNING=1` — внутрішній Stop-hook вийде відразу. `ADR_HOOKS_SKIP=1` (виставляє JS-оркестратор перед `npx @7n/rules lint`/`/n-lint`/`/n-doc-files`/`/n-taze` тощо) також блокує запуск раніше за ці guard'и — деталі в `adr/main.mdc`. Доступні ENV для нормалізації:

| Змінна | Default | Призначення |
| --- | --- | --- |
| `ADR_NORMALIZE_THRESHOLD` | `30` | Поріг чернеток для запуску фази. |
| `ADR_NORMALIZE_BATCH` | `10` | Максимум чернеток у одному виклику LLM. |
| `ADR_NORMALIZE_MIN_INTERVAL_HOURS` | `6` | Мінімум між спробами (навіть якщо поріг). |
| `ADR_NORMALIZE_DRY` | `0` | `1` — лише лог запланованих операцій, без змін на диску. |
| `ADR_NORMALIZE_BACKEND` | автовизначення | `local`/`pi`/`claude`/`cursor` — примусовий вибір бекенду (див. нижче). |
| `ADR_NORMALIZE_MODEL` | `sonnet` | Модель для бекенду `claude`. |
| `ADR_NORMALIZE_CURSOR_MODEL` | `claude-4.6-sonnet-medium` | Модель для бекенду `cursor`. |
| `ADR_NORMALIZE_PI_MODEL` | `$N_CLOUD_AVG_MODEL` (fallback `openai-codex/gpt-5.5`) | Модель для бекенду `pi`. |
| `ADR_NORMALIZE_LOCAL_CMD` | `npx --no @7n/rules adr-normalize-local` | Команда локального пайплайна (override для тестів/in-repo). |
| `ADR_NORMALIZE_SKIP_TOOLING_ONLY` | `1` | `0` — вимкнути structural skip tooling-only сесій (той самий прапор ділять capture і normalize). |

Для ручного запуску (поза порогом і поза Stop-хуком) є **`/n-adr-normalize`** — slash-команда тимчасово виставляє `ADR_NORMALIZE_THRESHOLD=0` і `ADR_NORMALIZE_MIN_INTERVAL_HOURS=0` та викликає скрипт напряму.

## Normalize LLM-бекенд: local → pi → claude → cursor

`ADR_NORMALIZE_BACKEND` (якщо не заданий явно) обирається автоматично:

1. **`local`** — якщо задано `N_LOCAL_MIN_MODEL`: конвеєр на малій локальній моделі (privacy + $0, `npm/scripts/lib/adr/normalize-pipeline.mjs`, викликається через `ADR_NORMALIZE_LOCAL_CMD`) сам будує дрібні промпти з батча.
2. **`pi`** — якщо `pi` є в `PATH`: `pi -p --model "$ADR_NORMALIZE_PI_MODEL" --no-prompt-templates`.
3. **`claude`** — якщо `claude` є в `PATH`: `claude -p --model "$ADR_NORMALIZE_MODEL"`.
4. **`cursor`** — якщо `cursor-agent` є в `PATH`: `cursor-agent -p --mode ask --output-format text --model "$ADR_NORMALIZE_CURSOR_MODEL"`.
5. Жодного бекенду — скрипт логує `no LLM backend available` і виходить з кодом `0` без змін.

Вибір LLM-бекенду для Capture (`CAPTURE_DECISIONS_BACKEND`: `pi`/`claude`/`cursor-agent`/`auto`, дефолт `pi`) — окремий механізм, задокументований в `adr/main.mdc`.

## Структура каталогу

```text
docs/adr/
├── YYMMDD-HHMM-<sid>.md       # drafts (frontmatter session:/captured:/transcript:)
└── YYMMDD-HHMM-<slug>.md      # clean ADR-и (без frontmatter, timestamp-префікс чернетки збережено)
.claude/hooks/
├── capture-decisions.sh       # auto-synced з пакета
├── normalize-decisions.sh     # auto-synced з пакета
├── capture-decisions.log      # лог запусків capture (НЕ коміти)
├── normalize-decisions.log    # лог запусків normalize (НЕ коміти)
├── .normalize-state           # timestamp останнього normalize-запуску (НЕ коміти)
└── .normalize.lock            # lock-файл (НЕ коміти)
.cursor/
└── hooks.json                 # Cursor Agent stop-hooks для тих самих скриптів
```

`.gitignore` у корені проєкту повинен містити базові рядки (`node_modules/`, `dist/`, `*.secret`) і патерни для ADR Stop-hook (**`.claude/hooks/*.log`**, `.claude/hooks/.normalize-state`, `.claude/hooks/.normalize.lock`). Канонічний фрагмент (дописується `npx @7n/rules`, коли правило `adr` увімкнене):

```gitignore
node_modules/
dist/
*.secret

# @7n/rules (adr) — локальні артефакти Stop-hook, не коміти
.claude/hooks/*.log
.claude/hooks/.normalize-state
.claude/hooks/.normalize.lock
.claude/scheduled_tasks.lock
```

## Наявність ADR Stop-хуків у `.claude/settings.json`

Rego-пакет: `adr.settings_json`

Цільовий файл: `.claude/settings.json`

Перевіряє, що project-shared файл містить **обидва** managed Stop-хуки — `capture-decisions.sh` і `normalize-decisions.sh` — у `hooks.Stop[*].hooks[*].command`. Помилка, якщо маркер будь-якого зі скриптів відсутній.

## Відсутність дублів ADR Stop-хуків у `.claude/settings.local.json`

Rego-пакет: `adr.settings_local_json`

Цільовий файл: `.claude/settings.local.json`

Перевіряє **зворотне** до `adr.settings_json`: local-файл **не повинен** містити маркерів `capture-decisions.sh` або `normalize-decisions.sh` у `hooks.Stop[*].hooks[*].command` — інакше кожен скрипт виконається двічі на одну Stop-подію.
