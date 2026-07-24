---
type: Rust Module
title: presets.rs
resource: llm-lib/crates/llm-lib/src/acp/presets.rs
docgen:
  crc: c1206deb
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`TierPreset` — одна структура для всіх трьох способів застосування тіру: `env` для Codex, `extra-arg` для Cursor і post-session протокольний виклик для Pi. Вона перекладає абстрактний `Tier::Min/Avg/Max` — єдиний `Tier`-enum для всіх типів викликів, не лише ACP — у конкретний спосіб резолвінгу моделі для кожного `super::AcpAgentKind`, а `label` задає людозрозумілий напис для UI. Викликач зливає `env` і `extra_args` у `super::session::SessionOptions` та передає `post_session_config` як є, без додаткового розгалуження по kind.

## Поведінка

`TierPreset` зберігає вже резолвлений результат вибору тіру як єдину форму для подальшого запуску: людиночитний `label` для UI, `env` або `extra_args` для спавну, або `post_session_config` для post-session налаштування. Саме цю структуру далі споживають виклики ACP/Session API та майбутній `oneShotAcp`, щоб не повторювати вибір механіки для кожного kind окремо.

`label` задає стабільну назву самого агентного kind-а, а `tier_preset` поєднує його з `Tier::Min/Avg/Max` і повертає повний пресет для конкретного способу резолвінгу моделі: для Codex — через env, для Cursor — через extra args, для Pi — через post-session крок. Усі варіанти мають непорожній UI-лейбл, а значення для Codex узгоджені з JS-пресетом через той самий формат конфігурації моделі.

## Публічний API

- TierPreset — Результат резолвінгу `AcpAgentKind × Tier`.
- label — Людинозрозумілий лейбл самого агента (рішення Д), незалежний від тіру.
- tier_preset — Резолвить `tier` у [`TierPreset`] для цього kind-у (рішення Б/Ж/З/З.1).

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
