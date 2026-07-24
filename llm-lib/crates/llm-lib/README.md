# llm-lib

Rust-порт env-контракту `@7n/llm-lib` (`model-tiers.mjs`) для проєктів, де
JS/Bun недоступний (Tauri webview, agent-server тощо) — плюс новий вимір,
якого JS-шар не має: доступ до потужних моделей через **особисту підписку**
(Cursor CLI, Codex) поряд із local/cloud тирами.

## Три примітиви, без вбудованого retry

Той самий fail-fast принцип, що й у `@7n/llm-lib`: кожен `one_shot_*` — рівно
один виклик; драбину ескалації будує caller.

- **`tiers`** — `resolve_model(Tier) -> Option<"provider/model-id">`, читає
  `N_LOCAL_MIN/AVG/MAX_MODEL` і `N_CLOUD_MIN/AVG/MAX_MODEL`. Той самий
  каскадний порядок, що й у JS: `Min → LOCAL_MIN→AVG→MAX→CLOUD_MIN`,
  `Avg → LOCAL_AVG→MAX→CLOUD_AVG`, `Max → LOCAL_MAX→CLOUD_MAX`.
- **`local_cloud::LocalCloud`** — один HTTP-виклик через [`genai`]: локальні
  провайдери (напр. `omlx`) — кастомний OpenAI-сумісний ендпоінт; будь-який
  інший provider-префікс — стандартна genai-автентифікація за env-ключем
  провайдера.
- **`acp::one_shot_acp`** — один виклик через [Agent Client Protocol]:
  спавнить уже залогінений локально агентський CLI (`agent login` /
  `codex login` виконано власником заздалегідь, без API-ключа в процесі) і
  веде сесію по stdio/JSON-RPC. `AcpAgentKind::Cursor` (нативний `agent acp`)
  і `AcpAgentKind::Codex` (офіційний міст `@agentclientprotocol/codex-acp`).

## Драбина — приклад композиції

```rust
use llm_lib::{acp::{AcpAgentKind, one_shot_acp}, LocalCloud, Tier};

async fn ask(local_cloud: &LocalCloud, prompt: &str) -> Result<String, llm_lib::LlmError> {
    if let Ok(text) = one_shot_acp(AcpAgentKind::Cursor, prompt).await {
        return Ok(text);
    }
    if let Ok(text) = one_shot_acp(AcpAgentKind::Codex, prompt).await {
        return Ok(text);
    }
    local_cloud.one_shot(Tier::Max, None, prompt).await
}
```

## Живі смок-тести (не автотести — реальна квота)

```bash
cargo run --example cursor_live   # потребує залогіненого `agent login`
N_LOCAL_MIN_MODEL=omlx/<model> OMLX_API_KEY=<ключ> cargo run --example local_live
N_LOCAL_MIN_MODEL=omlx/<model> OMLX_API_KEY=<ключ> cargo run --example ladder_live  # драбина з README цілком
```

## Обкатано (2026-07-13)

Драбина `ladder_live` перевірена в обох сценаріях, не лише happy path:

- Cursor залогінений на PATH → відповідає перший рунг (`acp:cursor`, ~7.6с).
- Cursor свідомо прибрано з PATH → `acp:cursor` падає з `No such file or
  directory`, драбина коректно йде далі, а не висить і не панікує.
- Спавн свідомо неіснуючого бінарника — автотест
  (`spawn_of_missing_binary_fails_fast_not_hangs`) підтверджує провал
  за секунди, не зависання.

**Відома шорсткість:** `acp:codex` (`@agentclientprotocol/codex-acp` через
`npx`) у прогоні з прибраним Cursor впав з `Internal error: "Not
initialized"` — драбина коректно пішла на `local` далі, тож поведінка
крейта правильна, але сам bridge-процес codex-acp у цьому середовищі
потребує окремого розслідування (можливо, гонка на cold-start `npx`, чи
інша передумова ініціалізації) перед тим, як покладатись на цей рунг у
проді.

## Чому не `pi_agent_rust`

Ліцензія `pi_agent_rust` (Dicklesworthstone) — MIT з райдером, що забороняє
використання Anthropic/OpenAI та будь-кому, хто діє від їхнього імені.
Substrate для ACP — офіційний SDK `agent-client-protocol` (Zed, Apache-2.0).

## Чому не `Rig`

`rig-core` — повний агентний фреймворк (RAG, vector stores, MCP) — набагато
більше за потрібне для каскадного виклику. `genai` — тонкий multi-provider
чат-клієнт (Apache-2.0), точніше відповідає задачі: менше залежностей,
нативний протокол на провайдера, кастомні ендпоінти через
`ServiceTargetResolver`.
