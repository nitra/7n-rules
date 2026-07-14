---
type: Rust Module
title: tiers.rs
resource: llm-lib/crates/llm-cascade/src/tiers.rs
docgen:
  crc: 5e5c175c
---

## Огляд

Тир-конфіг моделей — Rust-порт `model-tiers.mjs` з `@7n/llm-lib`. Тільки резолвінг env-змінних у `"provider/model-id"`; жодного retry чи каскаду викликів — драбину будує викликач.

## Поведінка

`resolve_model(tier)` каскадно розв'язує абстрактний тир у перший заданий spec, у тому ж порядку, що й `resolveModel` у JS:

- `Min` → `N_LOCAL_MIN_MODEL → N_LOCAL_AVG_MODEL → N_LOCAL_MAX_MODEL → N_CLOUD_MIN_MODEL`
- `Avg` → `N_LOCAL_AVG_MODEL → N_LOCAL_MAX_MODEL → N_CLOUD_AVG_MODEL`
- `Max` → `N_LOCAL_MAX_MODEL → N_CLOUD_MAX_MODEL`

Повертає `None`, якщо жодна відповідна змінна не задана. Порожній рядок в env трактується як відсутнє значення. `Avg` ніколи не падає на `CLOUD_MIN`; `Max` повністю оминає avg-тири; локальна модель перемагає хмарну того ж тиру.

## Публічний API

- `Tier` — абстрактний тир якості: `Min` (швидка/дешева), `Avg` (середня), `Max` (найпотужніша).
- `resolve_model(tier) -> Option<String>` — каскадний резолвінг env → `"provider/model-id"`.
- `local_min/local_avg/local_max/cloud_min/cloud_avg/cloud_max() -> Option<String>` — читання окремих env-змінних `N_LOCAL_*_MODEL` / `N_CLOUD_*_MODEL`.
- `parse_model_spec(spec) -> Result<(&str, &str), String>` — розбиває `"provider/model-id"` за першим `/` (в model-id можуть бути власні `/`); `Err` на рядок без `/` або з порожньою частиною.

## Гарантії поведінки

- Резолвінг детермінований і чисто читає env — без викликів моделей і побічних ефектів.
- Порядок каскаду збігається з JS-реалізацією `model-tiers.mjs` (закріплено тестами).
