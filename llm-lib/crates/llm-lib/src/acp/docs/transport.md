---
type: Rust Module
title: transport.rs
resource: llm-lib/crates/llm-lib/src/acp/transport.rs
docgen:
  crc: 6f3ef945
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
---

## Огляд

Спільний ACP transport для session API та one-shot фасаду. Модуль готує
команду агента, нормалізує середовище вкладеного `npx`, автоматично обирає
permission і читає один prompt-хід із progress та semantic idle-timeout.

## Поведінка

- Формує argv як `NAME=value` prefixes, базову команду та extra arguments.
- Для ACP-команд через `npx` очищає успадкований `npm_config_package`, якщо
  caller не передав явний override.
- Перетворює помилку побудови `AcpAgent` на типізований `LlmError::Provider`.
- Автоматично обирає `AllowAlways`, далі `AllowOnce`, далі перший доступний
  permission option.
- Веде semantic idle deadline: його скидають лише новий `ToolCall` або
  `AgentMessageChunk`. `UsageUpdate`, thought/config та повторні
  `ToolCallUpdate` більше не можуть нескінченно подовжувати завислий хід.
- Передає всі `SessionUpdate` викликачу. Коротко логує non-text progress;
  `N_LLM_ACP_VERBOSE=1` вмикає повний debug output.
- `N_LLM_ACP_PROGRESS=0` приглушує progress для оркестраторів із власним UI.

## Публічний API

- `idle_timeout` — повертає межу semantic inactivity.
- `build_acp_args` — готує env та argv для `AcpAgent::from_args`.
- `spec_for` — створює agent specification із tier env/arguments.
- `pick_auto_permission_option` — обирає non-interactive permission.
- `acp_verbose` — вмикає повний debug output.
- `acp_progress_enabled` — враховує quiet progress і verbose override.
- `summarize_update` — стискає progress event без raw tool payload.
- `drive_turn` — читає prompt-хід до `StopReason` або semantic timeout.
- `AcpSessionUpdates` — мінімальна абстракція джерела ACP updates.

## Гарантії поведінки

- Вкладений `npx` не успадковує package selector зовнішнього `npm exec`, якщо
  caller не задав його явно.
- Шумні events не обходять semantic idle timeout.
- Timeout, protocol error і spawn/spec error повертаються як типізовані
  помилки, а не маскуються порожнім результатом.
- Quiet progress не приховує events від callback.
