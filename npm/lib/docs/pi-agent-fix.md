---
type: JS Module
title: pi-agent-fix.mjs
resource: npm/lib/pi-agent-fix.mjs
docgen:
  crc: 1330a3e3
---

## Огляд

Тимчасовий shim Ф1 виносу `@nitra/llm-lib` (спека docs/specs/2026-07-05-llm-lib-extraction-spec.md): legacy-обгортка `runPiAgentFix` над `runAgentFix` пакета + інʼєкція n-cursor-специфічного AST-екстрактора (oxc `ast-extract`) як `deps.astContext` — у пакеті цей дефолт більше не живе (substrate-незалежність: пакет не тягне oxc).

## Поведінка

runPiAgentFix — викликає `runAgentFix` з `deps.astContext = extractContext(resolve(cwd, path))`, якщо колер не передав власний; решта opts проходять без змін.
buildFixPrompt — реекспорт з пакета без змін.

## Гарантії поведінки

- Явно переданий `opts.deps.astContext` має пріоритет над n-cursor-дефолтом.
- Контракт повернення ідентичний `runAgentFix` пакета: `{ applied, touchedFiles, telemetry, error, rollback }`.
