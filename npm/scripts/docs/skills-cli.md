---
type: JS Module
title: skills-cli.mjs
resource: npm/scripts/skills-cli.mjs
docgen:
  crc: e7a5fa46
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 90
  issues: internal-name:runTazeOrchestratorCli,judge-refine:kept-original,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл реалізує `npx @7n/rules skill ...` для запуску скілів пакета `@7n/rules` без синку правил у проєкт. Скіли читаються з `npm/skills/<id>/SKILL.md` установленого пакета або кешу `npx`; промпт поєднує інструкцію скілу з контекстом поточного CWD: `package.json`, `tsconfig.json`, `.n-rules.json`. Команда підтримує вивід промпта або запуск через pi/ACP-раннер: `cursor`/`codex` ідуть через `@7n/llm-lib/acp` / napi-міст, без власного JSON-RPC у JS.

Підтримані сценарії: `skill list`, `skill taze`, `skill pi taze`, `skill cursor taze`, `skill codex taze`. `taze` та `git-reconcile` спрямовуються в JS-оркестратори, бо мають детерміновані етапи й залучають LLM лише для частин, де потрібне змістове рішення.

## Поведінка

`runSkillsCli` приймає команду `skill`, знаходить корінь установленого пакета через `resolveBundledPackageRoot`, читає доступні скіли через `listSkillIds` і далі спрямовує виконання в один із підтримуваних потоків: показ списку, побудова промпта, запуск через pi/ACP або JS-оркестрований виняток.

`normalizeSkillId` задає спільне правило ідентифікації скіла для CLI-імен і каталогів, тому однакове ім’я використовується під час пошуку `SKILL.md`, перевірки спеціальних маршрутів і запуску раннера.

`buildSkillPrompt` формує самодостатній промпт із тексту скіла та контексту поточного проєкту. Контекст береться з робочого каталогу й може включати `package.json`, `tsconfig.json`, `.n-rules.json` і `.n-cursor.json`, щоб агент бачив важливі локальні налаштування без попереднього синку правил.

`isTazeOrchestratorSkillArgs` і `isJsOrchestratedSkillArgs` використовуються як ранні предикати маршрутизації: вони визначають, чи команда має піти в JS-оркестратор до будь-яких змін у root-проєкті. Це захищає worktree-only сценарії від побічної self-upgrade-мутації перед власними preflight-перевірками оркестратора.

Для звичайних скілів результатом є або готовий текст промпта на stdout, або exit code раннера. Вбудований pi-раннер є рекомендованим шляхом і бере модель із конфігурації скіла, зокрема `main.json`; зовнішні `cursor` і `codex` делегуються ACP-шару й повертають повну відповідь після завершення ходу.

Для `taze` та `git-reconcile` `runSkillsCli` обходить загальний режим “увесь SKILL.md одним промптом”: детермінована частина виконується JS-оркестратором, а LLM отримує лише обмежені задачі, де потрібне семантичне рішення або міграція.

## Публічний API

- resolveBundledPackageRoot — Корінь пакета `@7n/rules` (каталог з `skills/`, `rules/`, …).
- isTazeOrchestratorSkillArgs — Чи `argv` (аргументи після `skill`) резолвиться в JS-оркестрований
worktree-only `taze`-шлях (`runTazeOrchestratorCli`) — той самий критерій,
що й нижче в `runSkillsCli`. Використовується `n-rules.js`, щоб не мутувати
root `package.json` (self-upgrade `@7n/rules`) ДО власного worktree-гейту
оркестратора: той сам створює worktree і перевіряє чистоту дерева
(`ensureRunningInWorktree`, `requireCleanTree: true`) — мутація package.json
прямо перед цим викликом примусово провалила б auto-create там, де дерево
інакше було б чисте.
- isJsOrchestratedSkillArgs — Чи аргументи ведуть у будь-який JS-оркестрований skill. Потрібно верхньому
CLI, щоб не мутувати root package.json self-upgrade-ом до власного preflight
оркестратора.
- normalizeSkillId — приводить ідентифікатор skill до єдиного вигляду, щоб посилання на нього були стабільними незалежно від форми введення.
- listSkillIds — збирає доступні skill-ідентифікатори з налаштувань проєкту, спираючись на package.json, tsconfig.json, .n-rules.json, .n-cursor.json і main.json.
- buildSkillPrompt — формує текст інструкції для вибраного skill, щоб агент отримав потрібний контекст перед виконанням задачі.
- runSkillsCli — запускає CLI для перегляду або підготовки skill-підказок, щоб користувач міг працювати з ними з командного рядка.

## Сценарії використання

- `npm/scripts/tests/skills-cli.test.mjs` (normalizeSkillId; isTazeOrchestratorSkillArgs) — n-lint → lint; lint без змін; порожній рядок → порожній рядок; null/undefined → порожній рядок; cursor taze → true (JS-оркестрований worktree-only шлях); ще 30

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
