---
type: JS Module
title: fake-acp-agent.mjs
resource: llm-lib/tests/fixtures/fake-acp-agent.mjs
docgen:
  crc: c8356772
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл потрібен, щоб у `../acp.test.mjs` був фейковий ACP-Agent для тестів: він піднімає мінімальний `AgentSideConnection` на stdio, проходить один цикл із однією сесією та одним текстовим chunk. Це дає тестам передбачуваний агентський бік протоколу, де `stopReason` береться з `FAKE_ACP_STOP_REASON` або за замовчуванням стає `end_turn`.

## Поведінка

1. `connection` піднімає фейковий ACP-канал для тестів `../acp.test.mjs` і виступає мінімальною стороною Agent у stdio.
2. Він забезпечує один цикл роботи: ініціалізацію, створення однієї сесії та відповідь одним текстовим chunk.
3. Він повертає `stopReason` за значенням `FAKE_ACP_STOP_REASON`, а якщо його немає — використовує `end_turn`.
4. Він не виконує записів у ФС чи БД і не накопичує стан між викликами.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
