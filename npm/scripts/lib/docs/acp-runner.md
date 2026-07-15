---
type: JS Module
title: acp-runner.mjs
resource: npm/scripts/lib/acp-runner.mjs
---

## Огляд

Модуль виконує скіл через зовнішнього ACP-агента (Agent Client Protocol,
agentclientprotocol.com) — JSON-RPC поверх stdio замість сирого piping
`stdin`/`stdout` у CLI. Замінює колишній `runLlmCli` (`spawnSync` + `-p`/`exec -`)
для раннерів `cursor`/`codex`/`claude` у `skills-cli.mjs`.

`cursor` запускається через нативний ACP-режим `cursor-agent acp` (зовнішній
бінарник у PATH). `codex`/`claude` — через офіційні бандловані адаптери
(`@agentclientprotocol/codex-acp`, `@agentclientprotocol/claude-agent-acp`), що
самі керують своїм рушієм — зовнішній бінарник `codex`/`claude` у PATH більше
не потрібен.

## Поведінка

- `ACP_AGENT_COMMANDS` — команда запуску агента на провайдер: `cursor` — бінарник
  у PATH; `codex`/`claude` — резолвляться з `bin`-запису бандлованого пакета-адаптера.
- `stopReasonToExitCode` — мапить ACP `StopReason` прогону на exit code: `end_turn` → `0`,
  усе інше (`max_tokens`, `max_turn_requests`, `refusal`, `cancelled`) → `1`.
- `resolveAdapterBin` — резолвить абсолютний шлях до bin-файлу адаптера з його `package.json`.
- `pickAutoPermissionOptionId` — обирає `PermissionOption` без участі людини:
  `allow_always` > `allow_once` > перша опція. Паритет із non-interactive `-p`/`exec -`
  режимом — скіл є явною user-invocation, тож дозволи на tool-calls не питаються
  інтерактивно.
- `AcpSkillClient` (internal) — ACP `Client` для скіл-раннера: `requestPermission`
  автоапрувляє через `pickAutoPermissionOptionId`, `sessionUpdate` стрімить текстові
  дельти (`agent_message_chunk`) у переданий `out`, `readTextFile`/`writeTextFile`
  реалізовані напряму через `node:fs` (full-trust режим, без write-guard).
- `runAcpRunner` — підʼєднується до агента (`initialize` → `newSession` → `prompt`),
  повертає exit code за `stopReasonToExitCode`; при stopReason ≠ `end_turn` додатково
  логує причину через `logError`.

## Публічний API

- `ACP_AGENT_COMMANDS` — таблиця команд запуску на провайдер.
- `stopReasonToExitCode(stopReason)` — `StopReason` → `0 | 1`.
- `resolveAdapterBin(adapterPackage)` — шлях до bin-файлу адаптера.
- `pickAutoPermissionOptionId(options)` — `optionId` автообраного варіанту дозволу.
- `runAcpRunner(kind, prompt, projectDir, logError, deps?)` — виконує скіл через
  ACP-агента `kind` (`cursor`|`codex`|`claude`); `deps` — інжекти для тестів
  (`acp`, `spawnFn`, `out`, `resolveAdapterBin`, `isBinaryInPath`).

## Гарантії поведінки

- Permission-реквести від агента автоапрувляться без інтерактивного проміту —
  парність із колишнім non-interactive `-p`/`exec -` режимом (full user-trust,
  без write-guard, як і в `@7n/llm-lib/agent-skill`).
- `cursor` кидає, якщо `cursor-agent` відсутній у PATH (перевіряється до спавну
  дочірнього процесу). `codex`/`claude` перевірки PATH не потребують — резолвляться
  з установлених npm-залежностей.
- Дочірній процес агента завжди завершується (`child.kill()`) у `finally`, незалежно
  від результату прогону.
