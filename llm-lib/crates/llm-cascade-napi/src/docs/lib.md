---
type: Rust Module
title: lib.rs
resource: llm-lib/crates/llm-cascade-napi/src/lib.rs
docgen:
  crc: 4b743ae8
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

NAPI-біндінги для `llm-cascade`, що відкривають для `@7n/llm-lib` три публічні точки входу: `one_shot_acp`, `resolve_model` і `one_shot_local_cloud`. Тут зведено лише конвертацію значень між JS і Rust та мапінг помилок у `napi::Error`; уся ACP/tiers/local_cloud-логіка залишається в `llm-cascade`. Шар read-only: він не пише у ФС чи БД, працює fail-safe без винятків назовні, а за окремих помилок повертає порожнє значення, зокрема `null`.

## Поведінка

- `one_shot_acp` — виконує один ACP-виклик через вибраного агента та повертає текст відповіді або помилку в `napi::Error`.
- `resolve_model` — визначає модель для вказаного тиру й повертає її ідентифікатор або порожнє значення, якщо відповідник не знайдено.
- `one_shot_local_cloud` — виконує один chat-виклик через local/cloud каскад для вибраного тиру та повертає текст відповіді або помилку в `napi::Error`.

## Публічний API

- one_shot_acp — Один раз звертається до ACP-агента з особистою підпискою `cursor` або `codex`, використовуючи робочий каталог проєкту виклику, а не поточний каталог процесу.
- resolve_model — Перетворює абстрактний tir `min`/`avg`/`max` у конкретний `provider/model-id` за змінними `N_LOCAL_*` і `N_CLOUD_*`, без звернень у мережу.
- one_shot_local_cloud — Виконує один chat-запит для local/cloud тиру; `local_providers` задає JSON-мапу провайдерів із `baseUrl` та `apiKey`.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
