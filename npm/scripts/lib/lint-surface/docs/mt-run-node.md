---
type: JS Module
title: mt-run-node.mjs
resource: npm/scripts/lib/lint-surface/mt-run-node.mjs
docgen:
  crc: a5da3cb9
  model: openai-codex/gpt-5.4-mini
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Цей файл є executor-містом для fix-вузла MT у pi-harness: MT-runner (`@7n/mt#29`) спавнить цю команду замість вбудованого Claude-шляху для actor=agent вузлів. `argv[0]` і `MT_NODE_DIR` вказують на директорію вузла з `task.md` та `a.md`, `MT_WORKTREE` задає дерево, у якому застосовуються зміни, а `MT_MODEL_TIER` дублює `a.md` у значеннях `MIM|AVG|MAX`. Команда повертає stdout у форматі JSON `{"applied","touchedFiles"}`; `exit 0` означає, що MT сам запускає `## Check` і синтезує fact, а ненульовий exit означає `failed-run`. Її роль — виконати лише застосування змін у межах канонів тирів `omlx/pi-тири llm-lib`, тоді як claim/lease, worktree-ізоляція, budget/timeout, `## Check` і publish залишаються на стороні MT.

## Поведінка

- `parseNodeContract` — дістає з `task.md` правило з `## Check`, список target-файлів з `## Inputs` і текст задачі з `## Task`.
- `resolveTierLabel` — перетворює `MT_MODEL_TIER` у tier-label для `llm-lib`, а невідоме або порожнє значення зводить до `avg`.
- `buildViolationText` — формує текст порушення для agent-fix із задачі та, за наявності, додає перелік target-файлів; canonical-check лишається за `## Check`.
- `runNode` — читає `task.md`, парсить контракт вузла, підбирає tier і запускає виправлення в заданому worktree через інʼєкований або стандартний fix.
- `runNodeCli` — бере `node-dir` з argv або `MT_NODE_DIR`, запускає обробку вузла, друкує JSON зі станом виконання та повертає код завершення без пробросу винятків назовні.
- `recordNodeFixTelemetry` — успішний фікс із реальними правками пише запис `oldText→newText` у глобальний distillation-стор (Фаза C): MT-вузли живлять той самий крос-репо корпус маховика T0, що й інлайн-драбина; best-effort, лише applied без error.

## Публічний API

- parseNodeContract — дістає з `task.md` контракт вузла й перетворює його на придатний для виконання опис.
- resolveTierLabel — зв’язує `MT model_tier` із міткою `llm-lib`; для невідомого або порожнього значення підставляє `avg`.
- buildViolationText — формує текст порушення для агента на основі контракту вузла, без повторного визначення канонічної перевірки `## Check`.
- runNode — запускає один MT-вузол: читає контракт, готує виправлення нашим harness у worktree та повертає результат.
- runNodeCli — запускає `node_executor` як CLI: бере `node-dir` з `argv[0]`, використовує `MT_WORKTREE` і `MT_MODEL_TIER`, виводить у stdout JSON з `applied` і `touchedFiles`, а кодом завершення показує успіх або помилку екзекутора.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
