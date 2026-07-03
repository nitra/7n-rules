# Spec: ADR hooks - pi як capture-бекенд + skip оркестраторних сесій

**Дата:** 2026-06-30
**Статус:** Draft
**Тип:** Behavior change - `capture-decisions.sh` переходить з жорсткої драбини `claude -> cursor-agent` на селектор `CAPTURE_DECISIONS_BACKEND` з дефолтом `pi` (cloud-бекенди лишаються як явний opt-in); оркестраторні сесії повністю скіпають ADR hooks

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

### Частина B - `pi` як дефолтний capture-бекенд, cloud як opt-in

#### Селектор бекенду: `CAPTURE_DECISIONS_BACKEND`

Замість жорсткої драбини `claude -> cursor-agent -> skip` - env-селектор:

| Значення | Поведінка |
|---|---|
| `pi` (дефолт) | Тільки локальний `pi`; недоступний/без моделі -> `exit 0`, без fallback |
| `claude` | Примусово `claude -p` (як у поточному скрипті) |
| `cursor-agent` | Примусово `cursor-agent -p --mode ask` (як у поточному скрипті) |
| `auto` | Драбина за доступністю: `pi -> claude -> cursor-agent -> skip` |

Гілки `claude`/`cursor-agent` **не видаляються** - існуючий код інвокацій лишається, змінюється лише механізм вибору. Legacy env `CAPTURE_DECISIONS_CLAUDE_MODEL` і `CAPTURE_DECISIONS_CURSOR_MODEL` продовжують працювати для відповідних бекендів.

**Семантика `auto`:** fallback відбувається **за доступністю** (немає `pi`-бінарника або не задана локальна модель -> пробуємо `claude`), а **не** за результатом виклику. Порожня відповідь від обраного бекенду - фінальний результат: каскад на наступний бекенд після порожньої відповіді дублював би кожен "нема рішень у сесії" прогін платним cloud-викликом.

**Дефолт `pi`:** cloud вмикається лише свідомо (наприклад, `CAPTURE_DECISIONS_BACKEND=auto` у `~/.zshenv` того, кому потрібен capture без omlx). Це зберігає головну мету спеки - нуль випадкових cloud-витрат - і водночас дає повну сумісність зі старим поведінковим контрактом через одну змінну.

`normalize-decisions.sh` не змінює свій backend ladder у цій спеці, крім `ADR_HOOKS_SKIP` guard. Normalize важчий і вже має власний local pipeline / threshold; ця зміна стосується low-criticality capture-чернеток.

**Ратіонал:** capture - найменш критичний процес. Краще не зловити одну чернетку, ніж витратити хмарний баланс, сповільнити user session або створити рекурсивний шум. Локальна модель достатня для витягнення заголовків, контексту і conservative ADR draft. Кому потрібен capture на машині без omlx - вмикає cloud-бекенд явно.

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
CAPTURE_PI_MODEL="${CAPTURE_DECISIONS_PI_MODEL:-${N_LOCAL_MIN_MODEL:-}}"

if [[ -z "$CAPTURE_PI_MODEL" ]]; then
  log "  -> no local model configured (CAPTURE_DECISIONS_PI_MODEL / N_LOCAL_MIN_MODEL), skipping capture"
  exit 0
fi

log "  -> using pi (model: $CAPTURE_PI_MODEL)"
RESPONSE=$(printf '%s' "$PROMPT_FULL" \
  | "$PI_CMD" -p \
      --no-session \
      --mode text \
      --no-tools \
      --no-context-files \
      --no-extensions \
      --no-skills \
      --no-prompt-templates \
      --offline \
      --model "$CAPTURE_PI_MODEL" \
  2>>"$LOG" || true)
```

Обов'язкові прапори:

- `--no-session` - capture є one-shot аналізом transcript, без накопичення history;
- `--mode text` - plain Markdown output, не agent/task режим (це pi-дефолт, лишаємо для явності);
- `--no-tools` - модель не має читати/редагувати repo для capture;
- `--no-context-files` - без `AGENTS.md`/`CLAUDE.md` у prompt, щоб не забруднювати transcript analysis;
- `--no-extensions` - без discovery `.pi/extensions`: інакше pi завантажить сам `n-cursor-adr` extension (рекурсію прикриває успадкований `CAPTURE_DECISIONS_RUNNING`, але discovery - зайвий startup-час в async hook і залежність від сторонніх extension'ів, які можуть реєструвати тули/прапори);
- `--no-skills` / `--no-prompt-templates` - та сама герметичність для skills і prompt templates discovery;
- `--offline` - pi робить startup network operations; без цього прапора ціль "no-network hook" виконана лише наполовину (відмова від `npx` прибирає мережу package manager'а, але не самого pi).

**Модель: канон `N_LOCAL_MIN_MODEL`, без хардкоду.** Репо вже свідомо прибрало хардкод `DEFAULT_OMLX_MODEL` з docgen і cspell-fix на користь єдиного knob'а `N_LOCAL_MIN_MODEL` (`npm/lib/pi-model-tiers.mjs`). Capture слідує тому ж канону: специфічний override через `CAPTURE_DECISIONS_PI_MODEL`, інакше `N_LOCAL_MIN_MODEL`. Якщо жодна не задана - миттєвий silent skip з log-рядком (fail-loud, як у docgen, для async hook недоречний). Бонус: на машинах без omlx skip миттєвий, без плати за конект-таймаут на кожен Stop. Явна модель, а не pi subscription default - щоб capture не йшов у cloud випадково.

#### Поведінка при порожній відповіді

```bash
if [[ -z "$RESPONSE_TRIMMED" ]]; then
  log "  -> empty response from pi"
  exit 0
fi
```

Без каскаду на інший бекенд - і для `pi`, і для `auto`: порожня відповідь обраного бекенду фінальна. Логіка валідації відповіді (`NONE`, перевірка `## `, slug-генерація, запис draft-файлу) лишається без змін і спільна для всіх бекендів.

---

## Зміни по файлах

| Файл | Зміна |
|---|---|
| `npm/bin/n-cursor.js` | Виставити `process.env.ADR_HOOKS_SKIP = '1'` перед CLI `switch` |
| `npm/.claude-template/hooks/capture-decisions.sh` | Guard `ADR_HOOKS_SKIP`; селектор `CAPTURE_DECISIONS_BACKEND` (дефолт `pi`) з новою `pi`-гілкою, існуючі `claude`/`cursor-agent` гілки за селектором; оновити header-коментарі |
| `.claude/hooks/capture-decisions.sh` | Синхронізована project copy після зміни bundled template |
| `npm/.claude-template/hooks/normalize-decisions.sh` | Додати silent `ADR_HOOKS_SKIP` guard після `ADR_NORMALIZE_RUNNING` guard |
| `.claude/hooks/normalize-decisions.sh` | Синхронізована project copy після зміни bundled template |
| `npm/.pi-template/extensions/n-cursor-adr/index.ts` | Додати `env.ADR_HOOKS_SKIP` у top-level guard, щоб не спавнити обидва hooks |
| `npm/rules/adr/main.mdc` | Описати селектор `CAPTURE_DECISIONS_BACKEND` (дефолт `pi`) і `ADR_HOOKS_SKIP` |
| `npm/rules/adr/hooks/hooks.mdc` | Оновити розділ availability check: дефолтний бекенд `pi`, cloud-бекенди за селектором |
| `npm/rules/adr/hooks/main.mjs` | Інформативна перевірка `pi`: root `.bin`, nested `@nitra/cursor` `.bin`, `PATH`; враховувати `CAPTURE_DECISIONS_BACKEND` |
| `npm/rules/adr/hooks/tests/hooks.test.mjs` | Доповнити LLM CLI availability tests: `pi` як дефолт, `claude`/`cursor-agent` за селектором |
| `npm/rules/adr/tests/capture-decisions-cross-project.test.mjs` | Очікувати `pi not found` замість `no LLM CLI found` (дефолтний бекенд) |
| `npm/rules/adr/tests/capture-decisions-tooling-only.test.mjs` | Матриця бекендів: fake `pi` (дефолт, flags і запис draft), `CAPTURE_DECISIONS_BACKEND=claude` -> fake `claude`, `auto` без `pi` -> fallback на fake `claude` |
| `npm/rules/adr/tests/normalize-decisions-tooling-only.test.mjs` | Додати тест `ADR_HOOKS_SKIP=1` для silent normalize skip |
| `npm/scripts/tests/sync-pi-extensions.test.mjs` | Додати assertion на `ADR_HOOKS_SKIP` у bundled extension |
| `npm/scripts/dispatcher/tests/index.test.mjs` | Source test: `ADR_HOOKS_SKIP = '1'` виставлено до CLI `switch` |
| `docs/ci4/01-context.md`, `docs/ci4/02-containers.md`, `docs/ci4/03-components.md`, `docs/ci4/04-code.md` | Оновити architecture docs: capture backend `pi`, selector semantics, env guard |
| `npm/CHANGELOG.md` | Change entry через `npx @nitra/cursor lint changelog` |

`lib/tooling-only.sh` не змінюємо.

---

## ENV-змінні

| Змінна | Дефолт | Опис |
|---|---|---|
| `ADR_HOOKS_SKIP` | - | Якщо виставлено, `capture-decisions.sh`, `normalize-decisions.sh` і pi-extension виходять без роботи |
| `CAPTURE_DECISIONS_BACKEND` | `pi` | Селектор бекенду: `pi` \| `claude` \| `cursor-agent` \| `auto` (драбина за доступністю `pi -> claude -> cursor-agent -> skip`) |
| `CAPTURE_DECISIONS_PI_MODEL` | `$N_LOCAL_MIN_MODEL` | Override local model для `pi` capture-бекенду; без обох змінних `pi`-бекенд недоступний (silent skip або, при `auto`, fallback далі) |
| `N_LOCAL_MIN_MODEL` | - | Існуючий канон локальної min-tier моделі (`npm/lib/pi-model-tiers.mjs`); capture перевикористовує, не вводить власний хардкод |
| `CAPTURE_DECISIONS_CLAUDE_MODEL` | `sonnet` | Модель для `claude`-бекенду (існуюча змінна, поведінка без змін) |
| `CAPTURE_DECISIONS_CURSOR_MODEL` | `claude-4.6-sonnet-medium` | Модель для `cursor-agent`-бекенду (існуюча змінна, поведінка без змін) |

Legacy model-env не деприкейтяться: вони діють щоразу, коли відповідний бекенд обрано явно або через `auto`. Змінюється лише те, що без явного `CAPTURE_DECISIONS_BACKEND` cloud-бекенди більше не вмикаються самі.

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
3. `capture-decisions.sh` (дефолтний бекенд `pi`): без `pi` у root `.bin`, nested `.bin` і `PATH` пише `pi not found, skipping capture`, не викликає `claude` навіть якщо fake `claude` є в `PATH`.
4. `capture-decisions.sh`: fake `pi` у `$PROJECT_ROOT/node_modules/.bin/pi` отримує `--no-session --mode text --no-tools --no-context-files --no-extensions --no-skills --no-prompt-templates --offline --model <...>` і stdout із `## ADR ...` записується у файл з `YYMMDD-HHMM-<slug>.md`.
5. `capture-decisions.sh`: fake `pi` повертає порожній stdout -> hook exit `0`, log `empty response from pi`, draft не створюється.
6. `capture-decisions.sh`: без `CAPTURE_DECISIONS_PI_MODEL` і `N_LOCAL_MIN_MODEL` -> миттєвий exit `0` з log `no local model configured`, fake `pi` **не викликається**.
7. Cross-project і tooling-only тести лишаються, але очікування backend-log оновлюються з `no LLM CLI found` на `pi not found`.
8. `npm/rules/adr/hooks/main.mjs`: availability check проходить для root `node_modules/.bin/pi`, nested `node_modules/@nitra/cursor/node_modules/.bin/pi`, system `PATH`, і no-pi стану.
9. `npm/.pi-template/extensions/n-cursor-adr/index.ts`: source test підтверджує `ADR_HOOKS_SKIP` guard разом із `CAPTURE_DECISIONS_RUNNING` / `ADR_NORMALIZE_RUNNING`.
10. `npm/bin/n-cursor.js`: source test у `npm/scripts/dispatcher/tests/index.test.mjs` підтверджує, що `process.env.ADR_HOOKS_SKIP = '1'` виставляється **до** CLI `switch` (інакше переміщення рядка в окремий case пройде повз тести bash/extension-сторони, які перевіряють лише реакцію на вже виставлену змінну).
11. `CAPTURE_DECISIONS_BACKEND=claude` + fake `claude` у `PATH`: викликається `claude -p --model $CAPTURE_DECISIONS_CLAUDE_MODEL`, `pi` не викликається навіть якщо fake `pi` присутній.
12. `CAPTURE_DECISIONS_BACKEND=auto` без `pi` (нема бінарника або не задана модель) + fake `claude`: fallback на `claude`, лог фіксує обраний бекенд.
13. `CAPTURE_DECISIONS_BACKEND=auto` + fake `pi`, що повертає порожній stdout: hook exit `0`, fake `claude` **не викликається** - порожня відповідь не каскадить на cloud.

Реальний `pi`/omlx інтеграційний тест не потрібен у CI: достатньо fake executable. Це стабільніше, не залежить від локальної моделі, auth і availability `omlx serve`.

---

## Ризики і компроміси

- **Capture за замовчуванням вимикається всюди, крім машин із налаштованим локальним стеком.** Stop hook стріляє всередині Claude Code сесії, тож `claude` CLI на `PATH` є завжди - сьогодні capture працює у ~100% сесій. Після зміни дефолтний бекенд `pi` працює лише там, де є `pi` + `N_LOCAL_MIN_MODEL`/`CAPTURE_DECISIONS_PI_MODEL` + запущений локальний inference (omlx serve). Для консьюмерів без omlx (інші машини, CI) capture з коробки стає **повністю неактивним**, не "інколи пропускає". Це усвідомлений компроміс: capture - чернеткова автоматика, не blocking quality gate, і хмарний баланс на неї не витрачаємо. Пом'якшення: старий поведінковий контракт доступний однією змінною - `CAPTURE_DECISIONS_BACKEND=auto` (або `claude`) повертає cloud-capture свідомим opt-in, без правки скрипту.
- **Дефолт `pi` перекладає відповідальність на конфігурацію користувача.** Хто очікує capture без omlx - має сам виставити `CAPTURE_DECISIONS_BACKEND`; тихий skip легко не помітити. Мітигація: інформативна підказка в `adr` check (`npm/rules/adr/hooks/main.mjs`) про відсутній `pi`/модель і про селектор.
- `optionalDependencies` можуть бути вимкнені (`--omit=optional`, package-manager policy). У такому разі hook має тихо skipнути, а `adr` check має лише інформативно підказати про відсутній `pi`.
- `CAPTURE_DECISIONS_PI_MODEL`/`N_LOCAL_MIN_MODEL` з explicit `omlx/...` не має cloud fallback. Це навмисно, щоб capture не витрачав subscription/cloud balance.
- Зміна ламає очікування користувачів, які покладалися на автоматичний `claude`/`cursor-agent` fallback без конфігурації: дефолт стає `pi`. Міграція - одна змінна (`CAPTURE_DECISIONS_BACKEND=auto`), але вона потребує свідомої дії. Саме тому тип спеки - Behavior change, не Non-breaking.

---

## Вирішені питання

- `ADR_HOOKS_SKIP` не логувати: silent early-exit.
- Тестувати `pi` через fake executable, не через справжній локальний inference.
- `pi` брати npm-first: root `.bin`, nested `@nitra/cursor` `.bin`, потім system `PATH`; `npx`/`npm exec` у hook не використовувати.
- Модель без хардкоду: `CAPTURE_DECISIONS_PI_MODEL` -> `N_LOCAL_MIN_MODEL` -> silent skip. Канон із `npm/lib/pi-model-tiers.mjs`, не власний дефолт (репо вже прибирало хардкод `DEFAULT_OMLX_MODEL` з docgen/cspell-fix).
- Виклик `pi` герметичний і офлайн: `--no-extensions --no-skills --no-prompt-templates --offline` обовʼязкові, discovery і startup network ops у Stop-hook недопустимі.
- Сумісність із cloud-бекендами через селектор: `CAPTURE_DECISIONS_BACKEND` = `pi` (дефолт) | `claude` | `cursor-agent` | `auto`. Гілки `claude`/`cursor-agent` не видаляються, legacy model-env продовжують діяти для відповідних бекендів.
- Дефолт - `pi`, не `auto`: cloud-capture лише свідомим opt-in, нуль випадкових cloud-витрат з коробки.
- `auto`-fallback - за доступністю бекенду, не за порожньою відповіддю: порожній результат обраного бекенду фінальний, без каскаду на платний виклик.
