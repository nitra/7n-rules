---
type: JS Module
title: max-tokens.mjs
resource: llm-lib/lib/internal/max-tokens.mjs
docgen:
  crc: 27cc0fa4
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`DEFAULT_MAX_TOKENS` задає стандартну верхню межу токенів для одноразових LLM-викликів у pi-сесіях, а `applyMaxTokens` застосовує цю межу там, де потрібне явне обмеження. Це потрібно, щоб поведінка викликів була передбачуваною і не залежала від неявних припущень у викликуючому коді.

## Поведінка

DEFAULT_MAX_TOKENS задає спільну верхню межу для одноразових LLM-викликів у pi-сесіях і бере значення з `N_LLM_MAX_TOKENS` або застарілого `N_PI_MAX_TOKENS`, а якщо обидва не задані — використовує безпечний дефолт. Це значення опирається на стелю моделі з `models.json`, тому без явного обмеження сесія успадковує модельний ліміт незалежно від фактичної потреби відповіді.

applyMaxTokens застосовує цю межу до вже створеної session так, щоб усі подальші LLM-виклики всередині тієї ж сесії отримували однаковий maxTokens. Якщо в session немає доступного agent streamFn або межа не задана, функція нічого не змінює і повертає ту саму session.

## Публічний API

- DEFAULT_MAX_TOKENS — Дефолтна стеля відповіді для агентних/one-shot викликів. Override: `N_LLM_MAX_TOKENS` (legacy-alias `N_PI_MAX_TOKENS`).
- applyMaxTokens — Обгортає `session.agent.streamFn`, домішуючи `maxTokens` в options
кожного LLM-виклику сесії. Безпечний no-op для сесій без `agent`
(напр. інжектовані фейки в тестах).

## Сценарії використання

- `llm-lib/tests/max-tokens.test.mjs` (pi-max-tokens) — wraps agent.streamFn injecting the default maxTokens into stream options; respects an explicit maxTokens override; is a safe no-op for sessions without agent.streamFn (injected fakes); does not wrap when maxTokens is explicitly falsy

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
