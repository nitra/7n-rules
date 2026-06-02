---
kind: nitra-plan
spec: ../specs/2026-06-02-flow-release-infer-ws.md
flow: ../../.worktrees/flow-release-infer-ws.flow.json
status: draft
---

# План: flow release інференс воркспейсу

Дата: 2026-06-02
Spec: [2026-06-02-flow-release-infer-ws](../specs/2026-06-02-flow-release-infer-ws.md)

## Кроки

1. Падаючі тести release (commands.test.mjs) з ін'єкцією listWorkspaces/changedFilesSince: один subWs → --ws додано; кілька → exit 1; нуль → без --ws; явний --ws → без змін; changedFilesSince кидає → fail-soft — acceptance: тести існують і падають.
2. Реалізувати інференс у release: deps.listWorkspaces/changedFilesSince з дефолтами; формування changeArgs; fail на кількох; fail-soft на помилці — acceptance: усі кейси кроку 1 зелені.
3. Change-файл (--ws npm) + локальні тести/lint — acceptance: bun test commands зелений; eslint exit 0; change-файл у npm/.changes/.
