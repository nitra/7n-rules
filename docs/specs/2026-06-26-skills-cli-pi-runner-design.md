# Skills-CLI runner на pi (замість `claude -p` / `cursor-agent -p`) — дизайн-спека

Дата: 2026-06-26
Власник: @vitaliytv
Статус: Ф1 реалізовано (гілка `feat/skills-cli-pi-runner`) — очікує ревʼю
Зачіпає: [`npm/scripts/skills-cli.mjs`](../../npm/scripts/skills-cli.mjs), `npm/lib/pi-agent-skill.mjs` (новий), [`npm/lib/pi-model-tiers.mjs`](../../npm/lib/pi-model-tiers.mjs), [`npm/lib/pi-trace.mjs`](../../npm/lib/pi-trace.mjs), `npm/skills/*/main.json` (нове поле `tier`), [`npm/bin/n-cursor.js`](../../npm/bin/n-cursor.js)

## Мета

Перевести **виконавчий канал скілів** `@nitra/cursor` із делегування у зовнішні CLI (`claude -p`, `cursor-agent -p`) на **вбудований pi-агент** (`createAgentSession` із `@earendil-works/pi-coding-agent`), щоб:

1. **Прибрати залежність від стороннього бінарника.** `skill <id>` має виконуватись «з коробки» через ту саму pi-екосистему, що вже крутить fix-engine (див. сусідню спеку [pi-fix-engine-migration](2026-06-26-pi-fix-engine-migration.md)), без вимоги мати в PATH `claude`/`cursor-agent`.
2. **Уніфікувати LLM-субстрат.** Skills-канал і fix-engine ділять один `ModelRegistry`/`AuthStorage` (`~/.pi/agent`), одні тири моделей, один глобальний trace — замість окремого `spawnSync` стороннього агента.
3. **Лишити поведінковий паритет.** Скіл, запущений через pi, має той самий доступ (читання/запис файлів, виконання `bash`), що й через `claude -p` сьогодні.

Цей канал — **останній** залишковий зовнішній LLM-процес у проєкті: omlx→pi-as-library для не-agent задач і fix-engine уже мігровано (squash `b167ebcf`); `npm/lib/llm.mjs`/`omlx.mjs` у головному дереві відсутні. Після цієї спеки `@nitra/cursor` не спавнить **жодного** стороннього LLM-CLI.

## Передісторія / проблема

[`npm/scripts/skills-cli.mjs`](../../npm/scripts/skills-cli.mjs) — CLI запуску скілів пакета без синку правил у проєкт. Поточна семантика:

- `skill list` — список скілів.
- `skill <id> ["task"]` — **друкує зібраний промпт у stdout** (не виконує; корисно для пайпів/інспекції, напр. `/n-llm-patch`).
- `skill cursor <id> ["task"]` — `spawnSync('cursor-agent', ['-p'])`, промпт у stdin.
- `skill claude <id> ["task"]` — `spawnSync('claude', ['-p'])`, промпт у stdin.

Збір промпта (`buildSkillPrompt`, [skills-cli.mjs:94](../../npm/scripts/skills-cli.mjs:94)) уже **runner-agnostic**: SKILL.md + контекст CWD (`package.json`, `tsconfig.json`, `.n-cursor.json`), нічого не знає про claude/cursor. Уся прив'язка до зовнішнього CLI зосереджена в `runLlmCli` ([skills-cli.mjs:132](../../npm/scripts/skills-cli.mjs:132)) — це єдиний seam, що мігрує.

**Парадокс той самий, що у fix-engine:** `@nitra/cursor` уже громадянин pi-екосистеми (одна сесія, одні моделі, write-tools, телеметрія), але виконавчий канал скілів шелить зовнішній агент. Pi вже надає рівно потрібні примітиви: `createAgentSession` з повним набором tools (`read/edit/write/grep/find/ls` + **`bash`** через `createBashTool`), а також нативне розуміння формату SKILL.md (`loadSkills`, `formatSkillsForPrompt`, `parseSkillBlock`).

## Non-goals

- **Не чіпати збір промпта.** `buildSkillPrompt` лишається як є (рішення: мінімальна зміна, без pi-native skill-loading — див. §3). Підтримка `package.json`/`tsconfig`/`.n-cursor.json`-контексту зберігається.
- **Не вводити write-guard для скілів.** Скіл викликається користувачем явно — повний user-trust, паритет із поточним `claude -p` (§4). Write-safety §12 fix-engine-спеки сюди **не** переноситься.
- **Не міняти JS-оркестровані скіли.** `doc-files`, `lint`, `coverage-fix` тощо, що оркеструються власним JS (а не диспатчем агента), цей канал не зачіпає — вони не йдуть через `runLlmCli`.
- **Не паралелізувати.** Один скіл — одна сесія.
- **Не дублювати спільну машинерію.** Model-tiers, глобальний trace, lazy-import-межа, optionalDependencies pi — переуживаються з [pi-fix-engine-migration](2026-06-26-pi-fix-engine-migration.md) (§3, §7, §10), не переписуються.

## Архітектура

```
┌─────────────────────────────────────────────────────────────┐
│ skills-cli.mjs                                               │
│   runSkillsCli → buildSkillPrompt (БЕЗ ЗМІН, runner-agnostic)│
│                       │                                      │
│        ┌──────────────┼───────────────┬──────────────┐       │
│        ▼              ▼               ▼              ▼        │
│   skill <id>     skill pi <id>   skill claude   skill cursor │
│   (stdout,       (ДЕФОЛТ-      (deprecated     (deprecated   │
│    без змін)      executor)      fallback)       fallback)   │
│                       │ lazy import                          │
│                       ▼                                      │
│        ┌──────────────────────────────────────┐             │
│        │ pi-agent-skill.mjs (новий)           │             │
│        │   createAgentSession                 │             │
│        │   tools: read/grep/find/edit/write/  │             │
│        │          ls/bash  (повний user-trust)│             │
│        │   tier ← main.json.tier → resolveModel│            │
│        │   turn-ceiling backstop · telemetry  │             │
│        └──────────────────────────────────────┘             │
│                       │ shared                               │
│        pi-model-tiers · pi-trace (kind:"skill")             │
└─────────────────────────────────────────────────────────────┘
```

## Рішення

### 1. Runner-семантика — pi дефолт, claude/cursor як deprecated fallback

`RUNNERS` розширюється до `{ pi, cursor, claude }`; **`pi` — рекомендований і дефолтний виконавець**.

- `skill <id>` — **без змін**: друкує промпт у stdout (не виконує). Незламна сумісність із пайпами/`n-llm-patch`.
- `skill pi <id> ["task"]` — **новий**: виконує скіл через вбудований pi-агент (`runPiAgentSkill`). Це заміна шляху `claude`/`cursor`.
- `skill claude <id>` / `skill cursor <id>` — **deprecated fallback**: далі шелять справжні `claude -p` / `cursor-agent -p` (для тих, у кого pi-модель ще не налаштована), але `runLlmCli` друкує одноразовий `[deprecated] skill <runner> → use 'skill pi'; зовнішній CLI буде прибрано` у stderr перед запуском.

`buildSkillPrompt` спільний для всіх трьох виконавців — жодного розгалуження у зборі промпта.

> Чому не hard-cutover (як fix-engine §«Фазовий план»): skills-канал — user-facing, з явними subcommand'ами `claude`/`cursor` у звичках і доках. Deprecated-fallback дає вікно міграції без поломки; видалення — окрема пізніша зачистка (§Фазовий план Ф2).

### 2. Модель — per-skill `tier` у `main.json`

Скіли різнорідні за складністю: `taze` рефакторить несумісний код (важко), `publish-telegram` готує текст (легко). Тому тира — **властивість скіла**, не глобальний дефолт.

`npm/skills/<id>/main.json` дістає опційне поле `tier`:

```jsonc
// npm/skills/taze/main.json
{ "auto": ["bun"], "worktree": true, "tier": "max" }
// npm/skills/publish-telegram/main.json
{ "auto": "завжди", "worktree": false, "requireRoot": false, "tier": "avg" }
```

- Значення: `"min" | "avg" | "max"` — мапиться напряму через наявний `resolveModel(tier)` ([pi-model-tiers.mjs:47](../../npm/lib/pi-model-tiers.mjs:47)).
- **Дефолт за відсутності поля — `"max"`**: скіли відкриті й агентні, слабка локальна gemma-4b на них іде в мета-рамблінг; безпечніше дефолтити в найсильніший тир, а здешевлення (`avg`/`min`) — свідома per-skill оптимізація.
- `runPiAgentSkill` читає `main.json` зачепленого скіла (той самий каталог, що й `SKILL.md`), бере `tier`, резолвить модель. `thinkingLevel` — за наявним `thinkingLevelForTier` (або `'medium'` дефолт для агентних скілів).

Стартовий маппінг (заповнюється при реалізації, не в коді спеки): важкі рефактори (`taze`) → `max`; генеративні/класифікаційні (`publish-telegram`, `adr-normalize`) → `avg`; прості — `min`.

### 3. Подача скіла — переуживаємо `buildSkillPrompt`

Рішення: **мінімальна зміна, без pi-native skill-loading**. `runPiAgentSkill(prompt, { skillDir, tier })` приймає вже зібраний `buildSkillPrompt`-рядок і подає його в `session.prompt(prompt)` — рівно як `claude -p` сьогодні дістає його через stdin.

pi-native `loadSkills`/`formatSkillsForPrompt`/`parseSkillBlock` **свідомо не використовуємо** на цьому етапі: вони вимагали б приведення skill-frontmatter до pi-формату й глибшої перебудови; виграш (скіл як first-class pi-концепт) не виправдовує обсяг для каналу, де `buildSkillPrompt` уже працює. Лишаємо як можливий майбутній рефактор (§Відкриті гепи).

### 4. Інструменти й безпека — повний user-trust

Скіл — **явна користувацька дія** (ти набираєш `n-cursor skill pi taze`), еквівалент запуску `claude -p` вручну, який теж без обмежень. Тому:

- **Повний набір tools:** `['read', 'grep', 'find', 'edit', 'write', 'ls', 'bash']`. `bash` **обов'язковий** — `taze` запускає `bun`, `coverage-fix` ганяє тести; без нього канал нефункціональний. Реалізація: спершу рядковий `'bash'` у `tools:[]` (built-in pi); якщо `createAgentSession` його не резолвить як вбудований — реєструємо явно через `createBashTool`/`createBashToolDefinition` у `customTools` (обидва експорти підтверджені в пакеті). Дрібниця реалізації, не дизайн-розвилка.
- **Без write-guard, без denylist, без fail-closed canary.** Контур §12 fix-engine-спеки (scope=git-root, `git check-ignore`, pre-image, canary) сюди **не** переноситься: він існує, бо fix-engine біжить автономно в `lint`/CI; скіли ж — інтерактивна user-invocation. Поведінковий паритет із поточним `claude -p` (який пише будь-куди й виконує будь-що).
- **Runaway-backstop зберігається** (єдиний лімітер): turn-ceiling (`N_CURSOR_FIX_TURN_CEILING`-аналог, окрема env `N_CURSOR_SKILL_TURN_CEILING`, дефолт ~80 — скіли довші за фікс) + per-call timeout. На перевищенні — `session.abort()`. Це не safety проти користувача, а захист від зациклення моделі.

> Наслідок: `bash`-tool робить будь-який write-guard напівдекоративним (агент усе одно може `rm`/`>` з шелу), тож вводити guard лише на `edit/write` було б ілюзією безпеки. Узгоджено: повний trust або нічого — обрано trust (паритет).

### 5. Сесія — модель `runPiAgentFix`, але generic

Новий [`npm/lib/pi-agent-skill.mjs`](../../npm/lib/pi-agent-skill.mjs) дзеркалить структуру [`pi-agent-fix.mjs`](../../npm/lib/pi-agent-fix.mjs), з відмінностями:

|              | `pi-agent-fix` (fix-engine)                         | `pi-agent-skill` (цей)                  |
| ------------ | --------------------------------------------------- | --------------------------------------- |
| Промпт       | `buildFixPrompt` (rule+violation)                   | готовий `buildSkillPrompt`-рядок        |
| Tools        | `read/grep/find/edit/write/ls/ast_facts/self_check` | `read/grep/find/edit/write/ls/**bash**` |
| Custom-tools | `ast_facts`, `self_check`                           | **немає**                               |
| Write-guard  | §12 (loader+canary)                                 | **немає** (user-trust)                  |
| Тира         | rung-сходи (escalation)                             | одна, з `main.json.tier`                |
| Сесія        | `inMemory()` per rung                               | `inMemory()` per виклик                 |
| Backstop     | turn-ceiling + per-tier timeout                     | turn-ceiling + per-call timeout         |
| Trace `kind` | `"agent"`                                           | `"skill"`                               |

Контракт: `runPiAgentSkill(prompt, { skillId, tier, modelSpec?, cwd, timeoutMs, deps }) → { ok, telemetry, error }` (без `touchedFiles` — без write-guard їх ніде відстежувати; активність видно в `telemetry.toolCallCount`). **`cwd` = каталог, звідки скіл викликали** (`projectDir`, який `runSkillsCli` уже передає в `runLlmCli` сьогодні) — без жодної спеціальної логіки (див. §7). Lazy `import('@earendil-works/pi-coding-agent')` (та сама optionalDependency, що в fix-engine §10). `stdio` агента стрімиться в inherit-консоль користувача (паритет із `claude -p`, де агент пише в термінал).

### 6. Телеметрія — переуживаємо глобальний trace

`runPiAgentSkill` пише через наявний `writeTrace` ([pi-trace.mjs](../../npm/lib/pi-trace.mjs)) у глобальний `~/.n-cursor/llm-trace.jsonl` (інваріант §7 fix-engine-спеки), із полями `caller: "skill:<id>"`, `kind: "skill"`, `skill`, `tier`, `model`, `backend: "pi-ai"`, `turnCount`, `toolCallCount`, `backstopHit`, `wallMs`, `error`. Distillation-маховик (fix-engine §13) скіли **не** охоплює — лише observability.

### 7. Worktree-скіли — `cwd` = каталог виклику, worktree робить сам агент

Рішення: **де викликали — там і працює.** `cwd` pi-сесії = `projectDir` (каталог запуску `n-cursor skill`), точно як `runLlmCli` сьогодні передає `claude -p`/`cursor-agent -p`. CLI **не** створює, не вгадує й не вибирає worktree.

Для скілів із `worktree: true` (`taze`, `lint`, `adr-normalize`) створення worktree — **перший крок самого скіла** за його `SKILL.md`-preflight (блок `n-cursor:worktree:start`): агент перевіряє, чи він під `.worktrees/`, і за потреби створює worktree від поточної гілки. Це поведінковий паритет — той самий preflight уже відпрацьовував під `claude -p`. Pi-агент має `bash` (§4), тож виконує ту саму послідовність команд із SKILL.md без участі CLI.

Наслідок: `runPiAgentSkill` лишається тонким і однаковим для worktree- і не-worktree-скілів — різницю несе тіло `SKILL.md`, не runner. Захищені директорії (`.claude/worktrees/`, `.worktrees/` у denylist git-ignore) при повному user-trust **не** форсуються кодом — їх береже preflight-конвенція скіла, як і раніше.

## Тестованість

Філософія fix-engine §9 — **мок на межі pi**:

- **Unit:** `runSkillsCli` із інжектованим `runPiAgentSkill` (через `deps`) — перевіряємо роутинг (`pi`/`claude`/`cursor`/bare), deprecation-warning, читання `tier` з `main.json`, fallback на `max`. Без pi.
- **Unit:** `pi-agent-skill` із scripted-провайдером (фейк assistant-turns із tool-calls, у т.ч. `bash`) — turn-ceiling, timeout-abort, telemetry-shape, touchedFiles.
- **Smoke (nightly):** реальний `skill pi <легкий-id>` проти справжньої моделі на fixture-репо — outcome-assert (скіл відпрацював, не runaway), не golden-file.
- Наявні тести `skills-cli` (`buildSkillPrompt`, `normalizeSkillId`, `listSkillIds`) лишаються — `buildSkillPrompt` не змінюється.

## Пакування / залежності

Без нових залежностей: `@earendil-works/pi-coding-agent` уже optionalDependency ядра (fix-engine §10), `pi-agent-skill` робить той самий lazy dynamic `import()` із presence-check і ясною помилкою (`pi не встановлено — використай 'skill claude' або встанови pi`). Bin лишається plain-node ESM.

## Фазовий план

- **Ф0 — спайки fix-engine: ✅ DONE** (function-calling + bun×SDK headless покривають і цей канал; `bash`-tool — нативний pi built-in, окремого спайку не потребує; за потреби — мінімальний smoke `skill pi` на тривіальному скілі).
- **Ф1 — pi-runner (один PR): ✅ DONE** (гілка `feat/skills-cli-pi-runner`). `pi-agent-skill.mjs` (createAgentSession + bash, без write-guard, turn-ceiling+timeout, trace `kind:"skill"`); `RUNNERS` += `pi`; `runSkillsCli` async, роутинг pi/claude/cursor із deprecation-warning; `tier`+`requireRoot` у схемі `skill-meta.json` + `skillTier()` (дефолт `max`) + валідація в check-концерні; `await runSkillsCli` у bin; тести (skills-cli routing + pi-agent-skill scripted-session + skillTier). claude/cursor-гілки робочі.
- **Ф2 — заповнення тир + зачистка:** проставити `tier` кожному агентному скілу за смоуком; після вікна міграції — **видалити** `claude`/`cursor` runner-гілки й `isBinaryInPath`-плюмбінг (skills-канал стає pi-only). Гейтиться сигналом, що pi-runner стабільний на всіх агентних скілах.

## Відкриті гепи

Закриті в цій ітерації: ~~bash-tool API~~ (§4 — рядок `'bash'` із fallback на `createBashTool`), ~~worktree-узгодження~~ (§7 — `cwd` = каталог виклику, worktree робить сам агент за SKILL.md-preflight).

Лишається відкритим:

1. **Turn-ceiling для скілів** — дефолт `~80` (env `N_CURSOR_SKILL_TURN_CEILING`); відкалібрувати за смоуком (скіли об'ємніші за фікс одного правила). Не блокер Ф1.
2. **Стартовий маппінг тир** per-skill (`main.json.tier` кожному агентному скілу) — у Ф2 за результатами смоуку, не в коді спеки.
3. **pi-native skill-loading** (`loadSkills`/`formatSkillsForPrompt`/`parseSkillBlock`) — можливий майбутній рефактор, якщо захочемо скіли як first-class pi-концепт. Зараз свідомо ні (§3) — поза обсягом цієї спеки.

## Посилання

- Сусідня спека (спільна машинерія): [2026-06-26-pi-fix-engine-migration](2026-06-26-pi-fix-engine-migration.md) — §3 (model-tiers), §7 (global trace), §10 (packaging/lazy-import), §12 (write-safety — навмисно НЕ переуживається тут).
- pi: [github.com/earendil-works/pi](https://github.com/earendil-works/pi) · [pi-coding-agent SDK docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
- Реалізаційні точки: [`npm/scripts/skills-cli.mjs`](../../npm/scripts/skills-cli.mjs) (`runLlmCli` seam), [`npm/lib/pi-agent-fix.mjs`](../../npm/lib/pi-agent-fix.mjs) (структурний зразок), [`npm/lib/pi-model-tiers.mjs`](../../npm/lib/pi-model-tiers.mjs) (`resolveModel`).
