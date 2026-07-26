---
type: Rust Module
title: transport.rs
resource: llm-lib/crates/llm-lib/src/acp/transport.rs
docgen:
  crc: d57b15c5
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Спільний ACP transport для session API та one-shot фасаду. Модуль готує
команду агента, нормалізує середовище вкладеного `npx`, автоматично обирає
permission і читає один prompt-хід із progress та idle-timeout.

## Поведінка

- Формує argv як `NAME=value` prefixes, базову команду та extra arguments.
- Для ACP-команд через `npx` очищає успадкований `npm_config_package`, якщо
  caller не передав явний override. Це не дає зовнішньому
  `npm exec --package=...` підмінити package вкладеного ACP runner.
- Перетворює помилку побудови `AcpAgent` на типізований `LlmError::Provider`.
- Автоматично обирає `AllowAlways`, далі `AllowOnce`, далі перший доступний
  permission option.
- Застосовує `N_LLM_ACP_IDLE_TIMEOUT_MS` до кожного окремого читання події, а
  не до всієї тривалості ходу.
- Передає всі `SessionUpdate` викликачу. Коротко логує non-text progress;
  `N_LLM_ACP_VERBOSE=1` вмикає повний debug output.

## Публічний API

- `idle_timeout` — повертає межу тиші між ACP events.
- `build_acp_args` — готує env та argv для `AcpAgent::from_args`.
- `spec_for` — створює agent specification із tier env/arguments.
- `pick_auto_permission_option` — обирає non-interactive permission.
- `summarize_update` — стискає progress event без raw tool payload.
- `drive_turn` — читає prompt-хід до `StopReason`.
- `AcpSessionUpdates` — мінімальна абстракція джерела ACP updates.

## Гарантії поведінки

- Вкладений `npx` не успадковує package selector зовнішнього `npm exec`, якщо
  caller не задав його явно.
- Регулярні ACP events продовжують хід незалежно від загальної тривалості.
- Тиша, protocol error і spawn/spec error повертаються як помилки, а не
  маскуються порожнім результатом.
