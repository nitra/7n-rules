---
kind: nitra-plan
spec: ../specs/2026-06-02-flow-trace-relative-links.md
flow: ../../.worktrees/flow-trace-relative-links.flow.json
status: draft
---

# План: trace relative-links + flow як інфо

Дата: 2026-06-02
Spec: [2026-06-02-flow-trace-relative-links](../specs/2026-06-02-flow-trace-relative-links.md)

## Кроки

1. Падаючі тести `trace`: file-relative лінк між наявними доками → ok (без розриву);
   root-relative → ok (fallback); chain-поле на неіснуючий → розрив (exit 1); `flow:` на
   неіснуючий → показано, не розрив (exit 0) —
   acceptance: тести існують і падають на поточній реалізації.
2. У `trace.mjs`: `resolveLink(root, file, target, exists)` = relative-to-file OR root; розділити
   chain-поля та інформаційне `flow`; `analyze` → `{field,target,ok,breaking}`; exit лише за
   `breaking && !ok`; `render` — нейтральний маркер для не-breaking —
   acceptance: усі кейси кроку 1 зелені.
3. Покласти change-файл (`--ws npm`); локальні тести/lint —
   acceptance: `bun test` trace зелений; eslint змінених файлів exit 0; change-файл у `npm/.changes/`.
