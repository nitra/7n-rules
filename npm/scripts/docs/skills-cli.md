---
type: JS Module
title: skills-cli.mjs
resource: npm/scripts/skills-cli.mjs
docgen:
  crc: 815b08d6
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 90
  issues: internal-name:runTazeOrchestratorCli,judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл реалізує CLI-команду запуску скілів пакета `@7n/rules` без синку правил у проєкт. Скіли читаються з `npm/skills/<id>/SKILL.md` установленого пакета або кешу `npx`; команда збирає промпт з інструкції скілу та контексту поточного CWD і або виводить його, або передає вибраному runner.

Підтримуються сценарії `skill list`, `skill taze`, `skill pi taze`, `skill cursor taze`, `skill codex taze` і deprecated `skill claude taze`. `pi` запускає вбудований pi-агент, `cursor` і `codex` працюють через `@7n/llm-lib/acp`, а deprecated `claude` використовує окремий адаптер `./lib/acp-runner.mjs`.

Для `taze` команда не передає весь `SKILL.md` одним великим запитом, а делегує виконання в `../skills/taze/js/orchestrate.mjs`. Це потрібно, щоб оновлення залежностей проходило детерміновано як backup/bump/diff/cleanup, а LLM-runner викликався окремо для кожного major-package, зберігаючи прогрес і діагностику при збоях окремих пакетів.

## Поведінка

`runSkillsCli` є входом у сценарій: визначає корінь установленого пакета через `resolveBundledPackageRoot`, читає доступні скіли через `listSkillIds`, нормалізує назву через `normalizeSkillId` і або повертає список, або формує завдання для виконання.

Для звичайного запуску `buildSkillPrompt` поєднує інструкцію вибраного скілу з контекстом поточного проєкту. У цей контекст потрапляють наявні конфіги `package.json`, `tsconfig.json`, `.n-rules.json`, `.n-cursor.json`; відсутні файли просто не додаються до промпта. Готовий текст далі передається обраному runner: рекомендованому вбудованому pi-агенту або зовнішньому ACP-агенту. Результатом у всіх шляхах є exit code, а діагностика йде у передані канали виводу.

`main.json` використовується як метадані скілу для вибору тиру моделі у pi-шляху; якщо цієї інформації немає, застосовується типовий максимальний тир. Стан між запусками не зберігається, файл не виконує власних операцій запису.

`taze` має окремий потік. `isTazeOrchestratorSkillArgs` наперед визначає, чи аргументи ведуть у спеціальний оркестрований режим, щоб зовнішній виклик не змінив root-проєкт до перевірок worktree. У самому `runSkillsCli` цей режим оминає одноразове виконання всього `SKILL.md` і делегує оновлення залежностей оркестратору: детерміновані кроки виконуються без LLM, а runner викликається обмежено для кожного major-пакета окремо.

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
- normalizeSkillId — перетворює шлях або назву skill на стабільний ідентифікатор для подальшого пошуку та посилань.
- listSkillIds — повертає доступні ідентифікатори skills, спираючись на налаштування з package.json, tsconfig.json, .n-rules.json, .n-cursor.json і main.json.
- buildSkillPrompt — збирає текст інструкцій вибраного skill у готовий prompt для агента.
- runSkillsCli — обробляє CLI-команди для перегляду skills і виведення prompt потрібного skill.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
