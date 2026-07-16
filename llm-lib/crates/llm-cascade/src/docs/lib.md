---
type: Rust Module
title: lib.rs
resource: llm-lib/crates/llm-cascade/src/lib.rs
docgen:
  crc: eea81163
---

## Огляд

Корінь крейта `llm_cascade` — Rust-аналог env-контракту `@7n/llm-lib` (`model-tiers.mjs`), розширений ACP-бекендами особистих підписок (Cursor CLI, Codex) поряд із local/cloud тирами через genai. Збирає підмодулі `acp`, `local_cloud`, `tiers` і реекспортує їхні ключові примітиви (`one_shot_acp`, `AcpAgentKind`, `LocalCloud`, `resolve_model`, `Tier`).

## Поведінка

Успадкована філософія: **жодного вбудованого retry**. Кожен `one_shot_*` — рівно один виклик; невдача повертається як `CascadeError`, а драбину ескалації (наприклад `local-min → cloud-min → cloud-avg`, чи з ACP-підпискою попереду метрованого ключа) будує викликач, компонуючи примітиви крейта.

## Публічний API

`CascadeError` — плоска помилка каскаду без вкладеної типізації по бекендах (деталі провайдера/агента вже в тексті):

- `NoModelConfigured(Tier)` — для тиру не задано жодної env-змінної `N_LOCAL_*`/`N_CLOUD_*`.
- `InvalidModelSpec(String)` — рядок `"provider/model-id"` не пройшов парсинг.
- `Provider(String)` — помилка самого виклику (HTTP, ACP-хендшейк, процес).

## Гарантії поведінки

- Один виклик примітива — максимум один запит до моделі; повторів немає ніде в крейті.
- Порядок і склад драбини ескалації повністю під контролем викликача.
