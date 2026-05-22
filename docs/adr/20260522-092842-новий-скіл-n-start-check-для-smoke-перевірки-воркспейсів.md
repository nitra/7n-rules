---
session: f52457cf-7c94-4e13-b7b8-51c75ac7cb9b
captured: 2026-05-22T09:28:42+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/f52457cf-7c94-4e13-b7b8-51c75ac7cb9b.jsonl
---

## ADR Новий скіл `n-start-check` для smoke-перевірки воркспейсів

## Context and Problem Statement
У bun-монорепо проєктах не було автоматизованого способу перевірити, чи взагалі запускається кожен воркспейс. Потрібен скіл, який послідовно обходить усі воркспейси й прогоняє `scripts.start` як smoke-тест.

## Considered Options
* Новий скіл `n-start-check` у `npm/skills/start-check/`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Новий скіл `n-start-check`", because структура відповідає наявним скілам (`npm/skills/<id>/SKILL.md` + `auto.md`), і умова `[bun]` в `auto.md` автоматично активує його в bun-монорепо (так само як `taze`).

### Consequences
* Good, because transcript фіксує очікувану користь: скіл видно в `n-cursor skill list`, тести `auto-skills.test.mjs` та `skills-cli.test.mjs` проходять (19 pass, 0 fail), промпт збирається без помилок.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Нові файли: `npm/skills/start-check/SKILL.md`, `npm/skills/start-check/auto.md` (вміст `[bun]`)
- Команда верифікації: `node npm/bin/n-cursor.js skill list`, `bun test npm/scripts/auto-skills.test.mjs npm/scripts/skills-cli.test.mjs`

---

## ADR `perl` + `alarm` як механізм таймауту для smoke-перевірки `start`-скриптів

## Context and Problem Statement
macOS не має утиліти `timeout` у базовій поставці. Для обмеження часу виконання `start`-скриптів потрібен портативний watchdog, який правильно вбиває реальний процес і повертає значущий код виходу.

## Considered Options
* Фоновий процес + `sleep` + ручний `kill` (спочатку описано в SKILL.md)
* `perl -e 'alarm shift; exec @ARGV' 12 bun run start` (запропоновано користувачем)

## Decision Outcome
Chosen option: "`perl` + `alarm`", because `exec` зберігає PID, тож SIGALRM б'є по справжньому процесі, а не по обгортці; немає ручного юглінгу PID / `kill -0` / `wait`; код виходу `142` (`128+14`) однозначно маркує «дожив до таймауту» без додаткової логіки.

### Consequences
* Good, because transcript підтверджує: `demo`-воркспейс повернув `CODE=142`, лог містить `VITE v8.0.10 ready in 398 ms`, порт 5173 після перевірки вільний — orphan-процесів нема.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Команда: `perl -e 'alarm shift; exec @ARGV' 12 bun run start > /tmp/n-start-check.log 2>&1`
- Інтерпретація: `142` → dev-сервер стартував (OK); `0` → CLI завершився чисто (OK); інше → FAIL
- `SIGALRM` додано до `.cspell.json` як дозволене слово

---

## ADR Pre-flight перевірка мутаційних `start`-скриптів у `n-start-check`

## Context and Problem Statement
Під час реального прогону скіла на воркспейсі `npm` з'ясувалося, що `scripts.start: bun ./bin/n-cursor.js` — це не запуск сервера, а повний sync: команда без аргументів створила `npm/.cursor/`, `npm/.claude/`, `npm/AGENTS.md`, `npm/CLAUDE.md`, додала `devDependencies` й переписала `bun.lock`. Скіл повернув `CODE=0` (OK), хоча насправді змінив стан репо.

## Considered Options
* Запускати `start` наосліп у всіх воркспейсах
* Додати pre-flight перевірку й попередження для CLI з мутаційним ефектом

## Decision Outcome
Chosen option: "Pre-flight перевірка", because реальний smoke-тест виявив побічний ефект — повний sync із записом файлів; без застереження скіл дасть хибно-позитивний результат і зіпсує стан репо.

### Consequences
* Good, because transcript фіксує очікувану користь: після додавання pre-flight секції в SKILL.md `cspell` проходить чисто, а сам інцидент із `npm/` вручну відкочено (`rm -rf npm/.claude npm/.cursor …`, `git checkout -- npm/package.json bun.lock`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Файл із застереженням: `npm/skills/start-check/SKILL.md`, секція «### 3. Прогнати `start` послідовно»
- Прогін, що виявив проблему: `cd npm && perl -e 'alarm shift; exec @ARGV' 12 bun run start` → `CODE=0`, git status показав нові файли в `npm/`
- Відкат: `rm -rf npm/.claude npm/.cursor npm/.github npm/.gitignore npm/.n-cursor.json npm/AGENTS.md npm/CLAUDE.md && git checkout -- npm/package.json bun.lock`
