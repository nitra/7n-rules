---
type: Rust Module
title: lib.rs
resource: llm-lib/crates/llm-lib/src/lib.rs
docgen:
  crc: 88ee8dc6
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 80
---

## Огляд

Каскадний доступ до LLM — Rust-аналог env-контракту `@7n/llm-lib` (model-tiers.mjs), розширений ACP-бекендами особистих підписок (Codex, Cursor CLI) поряд із local/cloud тирами через [`genai`].  # Філософія (успадкована з `@7n/llm-lib`)  **Жодного вбудованого retry.** Кожен `one_shot_*` — рівно один виклик; невдача повертається як [`LlmError`], а драбину ескалації (як `local-min → cloud-min → cloud-avg` у JS-шарі) будує викликач, компонуючи примітиви крейта. Приклад драбини з ACP-підпискою попереду метрованого ключа:  ```no_run use llm_lib::{acp::{AcpAgentKind, one_shot_acp}, local_cloud::LocalCloud, tiers::Tier};  # async fn ladder(local_cloud: &LocalCloud, prompt: &str, cwd: &std::path::Path) -> Result<String, llm_lib::LlmError> { if let Ok(text) = one_shot_acp(AcpAgentKind::Cursor, prompt, cwd).await { return Ok(text); } if let Ok(text) = one_shot_acp(AcpAgentKind::Codex, prompt, cwd).await { return Ok(text); } local_cloud.one_shot(Tier::Max, None, prompt).await # } ```

## Публічний API

- LlmError — Помилка каскаду. Навмисно плоска — деталі провайдера/ACP-агента вже в тексті, без вкладеної типізації для кожного backend-у.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
