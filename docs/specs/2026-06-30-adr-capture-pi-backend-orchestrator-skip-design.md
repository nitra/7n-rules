# Spec: ADR hooks - pi як capture-бекенд + skip оркестраторних сесій

**Дата:** 2026-06-30
**Статус:** Draft
**Тип:** Behavior change - `capture-decisions.sh` переходить з `claude`/`cursor-agent` fallback на `pi`-only; оркестраторні сесії повністю скіпають ADR hooks

---

## Проблема

Два незалежних болі в ADR Stop-hook потоці:

**1. Оркестраторні сесії потрапляють у ADR hooks.**
`npx @nitra/cursor lint`, `/n-lint`, `/n-doc-files`, `/n-taze`, `/n-release` та інші JS-оркестровані активності можуть запускати внутрішню agent/LLM-сесію і породжувати транскрипт. Stop hooks розцінюють її як звичайну людську сесію: `capture-decisions.sh` викликає LLM для витягнення рішень, а `normalize-decisions.sh` може паралельно прокидатися на normalize-прохід. Для оркестраторів це технічний шум, не людська думка.

**2. `claude`/`cursor-agent` як capture-бекенд витрачають хмарний ресурс.**
`capture-decisions.sh` зараз вибирає бекенд жорстко: `claude` -> `cursor-agent` -> skip. Немає стабільного шляху використати локальний `pi`/omlx без правки скрипту. При нульовому балансі або відсутності cloud credentials capture стає шумним/дорогим або мовчки не працює.

---

## Рішення

### Частина A - `ADR_HOOKS_SKIP`: флаг оркестраторних ADR hooks

JS-оркестратор (`npm/bin/n-cursor.js`) виставляє env-змінну **до** будь-якого запуску дочірнього процесу, що може породити agent/LLM-сесію:

```js
process.env.ADR_HOOKS_SKIP = '1'
```

Назва навмисно ширша за попередню draft-ідею `ADR_CAPTURE_SKIP`: скіпати треба **обидва** ADR hooks, не лише capture. Інакше `normalize-decisions.sh` все одно може прокидатися після технічної сесії.

`capture-decisions.sh` і `normalize-decisions.sh` перевіряють прапор на самому початку, одразу після власних recursion guards і до створення директорій/логів:

```bash
if [[ -n "${ADR_HOOKS_SKIP:-}" ]]; then
  exit 0
fi
```

Це має бути silent skip, як recursion guard: не пишемо в `capture-decisions.log` / `normalize-decisions.log`, бо для логування довелося б створювати hook-директорію саме в сценарії, який має не залишати слідів.

**Де виставляти в JS.** Один виклик на початку CLI-dispatch у `npm/bin/n-cursor.js`, перед `switch (command)`. Це покриває `hook`, `lint`, `skill`, `adr-normalize-local`, `taze`, `release` та майбутні оркестраторні підкоманди без пер-case дублювання.

**pi-extension.** `npm/.pi-template/extensions/n-cursor-adr/index.ts` зараз на `agent_end` спавнить **обидва** bash-скрипти. Якщо `env.ADR_HOOKS_SKIP` виставлено, extension має `return` до серіалізації transcript і до `Promise.allSettled(...)`. Тобто скіпаються і capture, і normalize.

---

### Частина B - `pi` як єдиний capture-бекенд

#### Новий пріоритет бекендів

```text
pi (local/npm/system) -> skip
```

`claude` і `cursor-agent` **прибираємо** саме з `capture-decisions.sh`. Якщо `pi` недоступний або повернув порожньо, hook завершується `exit 0` без fallback.

`normalize-decisions.sh` не змінює свій backend ladder у цій спеці, крім `ADR_HOOKS_SKIP` guard. Normalize важчий і вже має власний local pipeline / threshold; ця зміна стосується low-criticality capture-чернеток.

**Ратіонал:** capture - найменш критичний процес. Краще не зловити одну чернетку, ніж витратити хмарний баланс, сповільнити user session або створити рекурсивний шум. Локальна модель достатня для витягнення заголовків, контексту і conservative ADR draft.

#### Чи можна використовувати `pi` через npm

Так, але через **локальний npm/bin**, а не через `npx` у hook.

Факти з поточного пакета:

- `npm/package.json` має `optionalDependencies`: `@earendil-works/pi-ai` і `@earendil-works/pi-coding-agent`;
- `@earendil-works/pi-coding-agent` експортує bin `pi`;
- у поточному workspace це дає `node_modules/.bin/pi`;
- у consumer repo bin може бути або hoisted у `$PROJECT_ROOT/node_modules/.bin/pi`, або вкладений у `$PROJECT_ROOT/node_modules/@nitra/cursor/node_modules/.bin/pi`.

Тому lookup має бути npm-first і без мережі:

```bash
PI_CMD=""

for candidate in \
  "$PROJECT_ROOT/node_modules/.bin/pi" \
  "$PROJECT_ROOT/node_modules/@nitra/cursor/node_modules/.bin/pi"
do
  if [[ -x "$candidate" ]]; then
    PI_CMD="$candidate"
    break
  fi
done

if [[ -z "$PI_CMD" ]]; then
  PI_CMD="$(command -v pi 2>/dev/null || true)"
fi

if [[ -z "$PI_CMD" ]]; then
  log "  -> pi not found, skipping capture"
  exit 0
fi
```

Не використовуємо `npx`, `npm exec` або `bunx` у Stop-hook: вони можуть торкатися мережі, кешу, package-manager locks і суттєво сповільнювати async hook.

#### Виклик

```bash
CAPTURE_PI_MODEL="${CAPTURE_DECISIONS_PI_MODEL:-omlx/gemma-4-e4b-it-OptiQ-4bit}"

log "  -> using pi (model: $CAPTURE_PI_MODEL)"
RESPONSE=$(printf '%s' "$PROMPT_FULL" \
  | "$PI_CMD" -p \
      --no-session \
      --mode text \
      --no-tools \
      --no-context-files \
      --model "$CAPTURE_PI_MODEL" \
  2>>"$LOG" || true)
```

Обов'язкові прапори:

- `--no-session` - capture є one-shot аналізом transcript, без накопичення history;
- `--mode text` - потрібен plain Markdown output, не agent/task режим;
- `--no-tools` - модель не має читати/редагувати repo для capture;
- `--no-context-files` - без `AGENTS.md`/`CLAUDE.md` у prompt, щоб не забруднювати transcript analysis.

Модель перемикається через `CAPTURE_DECISIONS_PI_MODEL`. Значення за замовчуванням лишається explicit local omlx model, а не pi subscription default, щоб capture не йшов у cloud випадково.

#### Поведінка при порожній відповіді

```bash
if [[ -z "$RESPONSE_TRIMMED" ]]; then
  log "  -> empty response from pi"
  exit 0
fi
```

Без fallback. Логіка валідації відповіді (`NONE`, перевірка `## `, slug-генерація, запис draft-файлу) лишається без змін.

---

## Зміни по файлах

| Файл | Зміна |
|---|---|
| `npm/bin/n-cursor.js` | Виставити `process.env.ADR_HOOKS_SKIP = '1'` перед CLI `switch` |
| `npm/.claude-template/hooks/capture-decisions.sh` | Guard `ADR_HOOKS_SKIP`; замінити `claude`/`cursor-agent` на `pi`-only backend; оновити header-коментарі |
| `.claude/hooks/capture-decisions.sh` | Синхронізована project copy після зміни bundled template |
| `npm/.claude-template/hooks/normalize-decisions.sh` | Додати silent `ADR_HOOKS_SKIP` guard після `ADR_NORMALIZE_RUNNING` guard |
| `.claude/hooks/normalize-decisions.sh` | Синхронізована project copy після зміни bundled template |
| `npm/.pi-template/extensions/n-cursor-adr/index.ts` | Додати `env.ADR_HOOKS_SKIP` у top-level guard, щоб не спавнити обидва hooks |
| `npm/rules/adr/main.mdc` | Описати `pi`-only capture backend і `ADR_HOOKS_SKIP` |
| `npm/rules/adr/hooks/hooks.mdc` | Оновити розділ availability check з `claude`/`cursor-agent` на `pi` |
| `npm/rules/adr/hooks/main.mjs` | Інформативна перевірка `pi`: root `.bin`, nested `@nitra/cursor` `.bin`, `PATH` |
| `npm/rules/adr/hooks/tests/hooks.test.mjs` | Переписати LLM CLI availability tests з `claude`/`cursor-agent` на `pi` |
| `npm/rules/adr/tests/capture-decisions-cross-project.test.mjs` | Очікувати `pi not found` замість `no LLM CLI found` |
| `npm/rules/adr/tests/capture-decisions-tooling-only.test.mjs` | Fake `pi` замість fake `claude`; перевірити flags і запис draft |
| `npm/rules/adr/tests/normalize-decisions-tooling-only.test.mjs` | Додати тест `ADR_HOOKS_SKIP=1` для silent normalize skip |
| `npm/scripts/tests/sync-pi-extensions.test.mjs` | Додати assertion на `ADR_HOOKS_SKIP` у bundled extension |
| `docs/ci4/01-context.md`, `docs/ci4/02-containers.md`, `docs/ci4/03-components.md`, `docs/ci4/04-code.md` | Оновити architecture docs: capture backend `pi`, selector semantics, env guard |
| `npm/CHANGELOG.md` | Change entry через `npx @nitra/cursor fix changelog` |

`lib/tooling-only.sh` не змінюємо.

---

## ENV-змінні

| Змінна | Дефолт | Опис |
|---|---|---|
| `ADR_HOOKS_SKIP` | - | Якщо виставлено, `capture-decisions.sh`, `normalize-decisions.sh` і pi-extension виходять без роботи |
| `CAPTURE_DECISIONS_PI_MODEL` | `omlx/gemma-4-e4b-it-OptiQ-4bit` | Explicit local model для `pi` capture-бекенду |

Legacy env `CAPTURE_DECISIONS_CLAUDE_MODEL` і `CAPTURE_DECISIONS_CURSOR_MODEL` перестають впливати на `capture-decisions.sh`. Вони можуть лишатися релевантними лише для інших старих шляхів, якщо такі є поза capture.

---

## Що НЕ змінюється

- `normalize-decisions.sh` backend ladder, threshold, lock/state files і `ADR_NORMALIZE_*` env, крім нового early `ADR_HOOKS_SKIP` guard.
- `lib/tooling-only.sh` - файловий structural filter лишається додатковим захистом для capture.
- `ADR_CAPTURE_SKIP_CROSS_PROJECT` - cross-project guard лишається.
- Формат чернеток (`session:` frontmatter), slug-генерація, collision handling і запис файлів.
- `pi` SDK runner для skills/fix-engine не стає залежністю capture у цій зміні: capture лишається bash + CLI, бо hook уже bash-орієнтований і має бути cheap/no-network.

---

## Тест-план

1. `capture-decisions.sh`: `ADR_HOOKS_SKIP=1` завершується `0`, не створює `docs/adr`, не створює log-файл.
2. `normalize-decisions.sh`: `ADR_HOOKS_SKIP=1` завершується `0`, не бере lock і не пише normalize log/state.
3. `capture-decisions.sh`: без `pi` у root `.bin`, nested `.bin` і `PATH` пише `pi not found, skipping capture`, не викликає `claude` навіть якщо fake `claude` є в `PATH`.
4. `capture-decisions.sh`: fake `pi` у `$PROJECT_ROOT/node_modules/.bin/pi` отримує `--no-session --mode text --no-tools --no-context-files --model <...>` і stdout із `## ADR ...` записується у файл з `YYMMDD-HHMM-<slug>.md`.
5. `capture-decisions.sh`: fake `pi` повертає порожній stdout -> hook exit `0`, log `empty response from pi`, draft не створюється.
6. Cross-project і tooling-only тести лишаються, але очікування backend-log оновлюються з `no LLM CLI found` на `pi not found`.
7. `npm/rules/adr/hooks/main.mjs`: availability check проходить для root `node_modules/.bin/pi`, nested `node_modules/@nitra/cursor/node_modules/.bin/pi`, system `PATH`, і no-pi стану.
8. `npm/.pi-template/extensions/n-cursor-adr/index.ts`: source test підтверджує `ADR_HOOKS_SKIP` guard разом із `CAPTURE_DECISIONS_RUNNING` / `ADR_NORMALIZE_RUNNING`.

Реальний `pi`/omlx інтеграційний тест не потрібен у CI: достатньо fake executable. Це стабільніше, не залежить від локальної моделі, auth і availability `omlx serve`.

---

## Ризики і компроміси

- Capture може пропустити рішення, якщо `pi` не встановився як optionalDependency або локальна omlx model недоступна. Це прийнятий компроміс: capture - чернеткова автоматика, не blocking quality gate.
- `optionalDependencies` можуть бути вимкнені (`--omit=optional`, package-manager policy). У такому разі hook має тихо skipнути, а `adr` check має лише інформативно підказати про відсутній `pi`.
- `CAPTURE_DECISIONS_PI_MODEL` з explicit `omlx/...` не має cloud fallback. Це навмисно, щоб capture не витрачав subscription/cloud balance.
- Зміна ламає очікування користувачів, які покладалися на `claude`/`cursor-agent` capture fallback. Саме тому тип спеки - Behavior change, не Non-breaking.

---

## Вирішені питання

- `ADR_HOOKS_SKIP` не логувати: silent early-exit.
- Тестувати `pi` через fake executable, не через справжній локальний inference.
- `pi` брати npm-first: root `.bin`, nested `@nitra/cursor` `.bin`, потім system `PATH`; `npx`/`npm exec` у hook не використовувати.
