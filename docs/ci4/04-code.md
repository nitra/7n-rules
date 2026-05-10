# CI4 / L4 — Code

Code-flow для всіх runtime-контейнерів. Mermaid `flowchart TD` (top-down) — потоки керування й даних на рівні файлів і експортованих функцій. GH Action ([`cnt-gh-action`](02-containers.md#cnt-gh-action)) і Package Artifact ([`cnt-pkg-artifact`](02-containers.md#cnt-pkg-artifact)) на L4 не розкриваються.

## Rule Sync

<a id="code-rule-sync"></a>

Послідовність `bin/n-cursor.js` без аргументів (default-команда `runSync`):

```mermaid
flowchart TD
    start(["npx @nitra/cursor"]) --> dispatch{"argv[0]?"}
    dispatch -- "undefined" --> ensureDev["ensureNitraCursorInRootDevDependencies(cwd)"]
    ensureDev --> upgrade["upgradeNitraCursorToLatestAndBunInstall()"]
    upgrade --> readCfg["readConfig() — utils/load-cursor-config.mjs"]
    readCfg --> autoR["detectAutoRules + detectAutoSkills"]
    autoR --> mergeCfg["mergeConfigWithAutoDetected()"]
    mergeCfg --> loopRules["for rule in cfg.rules"]
    loopRules --> copyMdc["copy mdc/<rule>.mdc → .cursor/rules/n-<rule>.mdc"]
    copyMdc --> loopRules
    loopRules --> cleanRules["видалити .cursor/rules/n-*.mdc, яких немає у cfg.rules"]
    cleanRules --> loopSkills["for skill in cfg.skills"]
    loopSkills --> copySkill["copy skills/<skill>/ → .cursor/skills/n-<skill>/"]
    copySkill --> loopSkills
    loopSkills --> cleanSkills["видалити .cursor/skills/n-*/, яких немає"]
    cleanSkills --> agents["build AGENTS.md з AGENTS.template.md + bullets"]
    agents --> bullets["buildAgentsCommandBulletItems(packageJson)"]
    bullets --> writeAgents["fs.writeFile(AGENTS.md)"]
    writeAgents --> claude["syncClaudeConfig() — sync-claude-config.mjs"]
    claude --> gha["syncSetupBunDepsAction() — sync-setup-bun-deps-action.mjs"]
    gha --> doneOk(["✨ Готово: N завантажено"])
```

**Експорт компонентів:** [`cmp-load-config`](03-components.md#cnt-rule-sync), [`cmp-auto-rules`](03-components.md#cnt-rule-sync), [`cmp-auto-skills`](03-components.md#cnt-rule-sync), [`cmp-build-agents`](03-components.md#cnt-rule-sync), [`cmp-sync-claude`](03-components.md#cnt-rule-sync), [`cmp-sync-gha`](03-components.md#cnt-rule-sync), [`cmp-ensure-devdep`](03-components.md#cnt-rule-sync), [`cmp-upgrade`](03-components.md#cnt-rule-sync).

## AGENTS Builder (sub-flow)

<a id="code-agents-builder"></a>

Деталь під-потоку, який збирає `AGENTS.md` (всередині [`code-rule-sync`](#code-rule-sync), вузли `agents` → `bullets` → `writeAgents`):

```mermaid
flowchart LR
    subgraph inputs["Inputs"]
        rulesDir[".cursor/rules/n-*.mdc"]
        skillsDir[".cursor/skills/n-*/"]
        rootPkg["root package.json (scripts)"]
        tmpl["AGENTS.template.md (з пакета)"]
    end

    rulesDir --> rulesBlock["{{#services}} … {{/services}}"]
    skillsDir --> skillsBlock["{{#skills}} … {{/skills}}"]
    rootPkg --> cmdBuilder["build-agents-commands.mjs<br/>buildAgentsCommandBulletItems()"]
    cmdBuilder --> cmdsBlock["{{#commands}} … {{/commands}}"]
    tmpl --> render["mustache-style render"]
    rulesBlock --> render
    skillsBlock --> render
    cmdsBlock --> render
    render --> out["AGENTS.md (повний перезапис)"]
```

**Свідомі властивості:**

- Шаблон у пакеті ([`AGENTS.template.md`](../../npm/AGENTS.template.md)) — джерело істини; редагувати згенерований `AGENTS.md` у проєкті користувача безглуздо (наступний sync переписує).
- `{{#commands}}` — фіксований порядок відомих ключів `package.json scripts` плюс додаткові `lint-*`, плюс канонічні рядки про `npx @nitra/cursor` і `npx @nitra/cursor check`. Логіка — у [`build-agents-commands.mjs`](../../npm/scripts/build-agents-commands.mjs).
- `{{#services}}` (правила) і `{{#skills}}` (skills) формуються зі стану диска `.cursor/rules/` та `.cursor/skills/` — туди потрапляють і керовані `n-*`, і будь-які інші, додані вручну.

## Check Runner

<a id="code-check-runner"></a>

`bin/n-cursor.js → runChecks(args)`:

```mermaid
flowchart TD
    cli(["npx @nitra/cursor check [args]"]) --> dispatch{"argv[0] === 'check'"}
    dispatch -- yes --> rc["runChecks(args)"]
    rc --> discover["discoverCheckScripts() → ['abie','adr','bun',…,'vue']"]
    discover --> empty{"available.length === 0"}
    empty -- yes --> errNo(["throw 'No check scripts found'"])
    empty -- no --> hasCfg{"existsSync .n-cursor.json"}
    hasCfg -- yes --> readCfg["readConfig() — гарантує $schema"]
    hasCfg -- no --> argsCheck
    readCfg --> argsCheck{"args.length > 0"}
    argsCheck -- yes --> useArgs["rulesToCheck = args"]
    argsCheck -- no --> fromAgents["discoverCheckRulesFromAgentsMd(available)"]
    fromAgents --> emptyAgents{"rules empty?"}
    emptyAgents -- yes --> doneNo(["log 'нічого не запущено'"])
    emptyAgents -- no --> useAgents["rulesToCheck = з AGENTS.md"]
    useArgs --> validateUnknown["filter unknown проти available"]
    useAgents --> validateUnknown
    validateUnknown --> hasUnknown{"unknown.length > 0"}
    hasUnknown -- yes --> errUnknown(["throw 'Unknown rules'"])
    hasUnknown -- no --> loop["for rule in rulesToCheck"]
    loop --> dynImport["await import(scripts/check-${rule}.mjs)"]
    dynImport --> callCheck["const code = await check()"]
    callCheck --> failCount{"code !== 0"}
    failCount -- yes --> incr["totalFailed++"]
    failCount -- no --> loop
    incr --> loop
    loop --> finalCheck{"totalFailed > 0"}
    finalCheck -- yes --> errFail(["throw 'N з M правил мають проблеми' (exit 1)"])
    finalCheck -- no --> doneOk(["log '✨ M/M без зауважень' (exit 0)"])
```

**Приклад одного `check-*.mjs` ([`check-text.mjs`](../../npm/scripts/check-text.mjs) — спрощено):**

```mermaid
flowchart LR
    invoke["check()"] --> walk["walkDir(repoRoot, filterFn)"]
    walk --> scan["для кожного файлу: regex/AST scan"]
    scan --> issues["збирає issues[]"]
    issues --> reporter["check-reporter.formatIssues(issues)"]
    reporter --> stdout["console.log → CLI output"]
    issues --> exitCode{"issues.length > 0"}
    exitCode -- yes --> ret1(["return 1"])
    exitCode -- no --> ret0(["return 0"])
```

Контракт `check-*.mjs`: експортує `check(): Promise<0 | 1>`. Сторонні сканери — у [`utils/`](../../npm/scripts/utils/) (наприклад, `bunyan-imports.mjs`, `redis-imports.mjs`, `conn-file-rules.mjs`).

## Stop-Hook

<a id="code-stop-hook"></a>

`bin/n-cursor.js stop-hook → runStopHookCli()`:

```mermaid
flowchart TD
    enter(["Claude Code Stop event"]) --> spawn["npx --no @nitra/cursor stop-hook (виклик з .claude/settings.json)"]
    spawn --> stdin["readStdin() — читати JSONL до EOF"]
    stdin --> guard["isRecursiveStopHookCall(stdin)"]
    guard --> isRec{"stop_hook_active === true?"}
    isRec -- yes --> exit0(["return 0 — exit code 0"])
    isRec -- no --> spawnCheck["spawn('npx', ['--no', '@nitra/cursor', 'check'])"]
    spawnCheck --> wait["await child exit"]
    wait --> code{"child.code"}
    code -- 0 --> ok(["return 0 — Claude продовжує"])
    code -- 1 --> blockClaude(["return 1 — Claude НЕ завершує хід"])
```

**Властивості:**

- TTY-fallback: якщо stdin — TTY (запуск вручну), `readStdin` повертає `''` миттєво; `guard` повертає `false`; запускається `check` як для звичайного CLI.
- Помилка `JSON.parse` у guard вважається "не рекурсія" (fallback на `false`).
- Лог Claude Code сам зберігає stdout/stderr дочірнього процесу.

## Capture-Decisions

<a id="code-capture-decisions"></a>

`.claude/hooks/capture-decisions.sh` (bash):

```mermaid
flowchart TD
    enter(["Claude Code Stop event (async)"]) --> envCheck{"$CAPTURE_DECISIONS_RUNNING === 1?"}
    envCheck -- yes --> exitGuard(["exit 0 — рекурсія, мовчки"])
    envCheck -- no --> findTranscript["знайти JSONL у ~/.claude/projects/.../<sid>.jsonl"]
    findTranscript --> jq["jq: витягнути text/thinking/tool_use → digest"]
    jq --> haveTools{"$(command -v claude || command -v cursor-agent)?"}
    haveTools -- none --> exitNoTool(["exit 0 — немає LLM CLI"])
    haveTools -- claude --> spawnClaude["claude -p --model $CAPTURE_DECISIONS_CLAUDE_MODEL"]
    haveTools -- cursor-agent --> spawnCursor["cursor-agent -p --mode ask --output-format text --model $CAPTURE_DECISIONS_CURSOR_MODEL"]
    spawnClaude --> output["модельний відгук"]
    spawnCursor --> output
    output --> hasBlock{"має '## ADR' / '## Runbook' / '## Knowledge'?"}
    hasBlock -- no --> exitNone(["exit 0 — нічого не пишемо"])
    hasBlock -- yes --> writeFile["fs: docs/adr/_inbox/&lt;ts&gt;-&lt;sid&gt;.md"]
    writeFile --> done(["exit 0"])
    spawnClaude -. "env CAPTURE_DECISIONS_RUNNING=1" .-> spawnClaude
    spawnCursor -. "env CAPTURE_DECISIONS_RUNNING=1" .-> spawnCursor
```

**Властивості:**

- Скрипт **завжди** завершує `exit 0` (за винятком ранніх hard-fail) — щоб не блокувати агента.
- `--mode ask` для `cursor-agent` навмисний: read-only Q&A режим без shell/edit.
- Дефолтні моделі: `claude → sonnet`, `cursor-agent → claude-4.6-sonnet-medium`. Перевизначення — env-vars `CAPTURE_DECISIONS_CLAUDE_MODEL`, `CAPTURE_DECISIONS_CURSOR_MODEL`.
- Канонічне джерело bash-скрипта — у пакеті; інстальоване [`cmp-sync-claude`](03-components.md#cnt-rule-sync) при правилі `adr` у `.n-cursor.json`.

## Related decisions

| Element                                             | ADR                                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Code-flow для всіх runtime-контейнерів              | [`docs/adr/_inbox/20260510-112235-20fb5843.md`](../adr/_inbox/20260510-112235-20fb5843.md) |
| `code-capture-decisions` — bash-flow і LLM-fallback | [`docs/adr/_inbox/20260510-112851-861696eb.md`](../adr/_inbox/20260510-112851-861696eb.md) |

Повний індекс — у [`decisions.md`](decisions.md).
