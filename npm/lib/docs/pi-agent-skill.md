---
type: JS Module
title: pi-agent-skill.mjs
resource: npm/lib/pi-agent-skill.mjs
docgen:
  crc: cbbddc86
---

## Огляд

Тимчасовий shim Ф1 виносу `@nitra/llm-lib` (спека docs/specs/2026-07-05-llm-lib-extraction-spec.md): re-export skill-раннера з `@nitra/llm-lib/agent-skill` під legacy-імʼям `runPiAgentSkill`, щоб не ламати наявні import-шляхи consumers до Ф2. Нового коду сюди не додавати.

## Поведінка

runPiAgentSkill — alias на `runAgentSkill` пакета, без власної логіки.

## Гарантії поведінки

- Поведінка ідентична `@nitra/llm-lib/agent-skill` — див. доку пакета.
