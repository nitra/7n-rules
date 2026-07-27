---
type: JS Module
title: provider.mjs
resource: plugins/lang-rust/taze/provider.mjs
docgen:
  crc: 57281592
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл знаходить Cargo-manifest-и в репозиторії, пропускаючи `node_modules`, готує промпт для роботи з Cargo-залежностями, створює резервні копії маніфестів перед змінами та прибирає ці копії після завершення. Він потрібен, щоб ізолювати роботу з manifest-ами, не втрачати початковий стан і безпечно виконувати запити, що звертаються до мережі.

Публічні функції: `buildCargoDependencyPrompt`, `findCargoManifests`, `backupCargoManifests`, `cleanupCargoBackups`.

## Поведінка

Потік починається з пошуку всіх Cargo.toml у корені репозиторію з пропуском node_modules, .worktrees, .claude/worktrees і target. Знайдені маніфести стають єдиним джерелом для подальших дій: з них готується перелік файлів для резервного копіювання та очищення, а для кожного major-оновлення формується окремий промпт на основі даних про зміну залежності.

buildCargoDependencyPrompt перетворює одну major-зміну на інструкцію для ітеративного кроку оновлення Rust-залежності. У тексті промпта враховується контекст маніфесту, щоб LLM працювала лише з тим крейтом, який уже відібрав оркестратор, а детерміновані кроки навколо нього залишалися поза її зоною впливу. Назви пакетів звіряються з даними з package.json, а сам опис апелює до записів у https://crates.io/crates/.

backupCargoManifests створює захист перед змінами: зберігає кожен маніфест разом із відповідним Cargo.lock поруч і додатково бере кореневий lock, якщо він є. Це важливо і для незалежних крейтів із власним lock-файлом, і для workspace-структур, де спільний lock координує весь набір залежностей. cleanupCargoBackups виконує зворотну дію після завершення обробки, прибираючи всі створені резервні копії для тих самих шляхів, щоб репозиторій повернувся до вихідного стану.

Уся взаємодія побудована як короткий цикл: знайти маніфести, за потреби перевірити доступність cargo-edit для переходу через major-межі, підготувати промпт для конкретної зміни, тимчасово зберегти файли перед редагуванням і прибрати їх після завершення.

## Публічний API

- buildCargoDependencyPrompt — Промпт ОДНОГО ітеративного виклику для Rust-крейта (кроки 4-6 SKILL.md,
Rust-гілка) для ОДНОГО major-крейта. Кроки 1-3/7/8 виконує оркестратор
детерміновано, без LLM.
- findCargoManifests — Знаходить Cargo.toml поза node_modules/.worktrees/.claude/worktrees/target (крок 0.2 SKILL.md).
- backupCargoManifests — Бекапить кожен Cargo.toml + Cargo.lock поруч із ним (незалежні крейти,
як Tauri `src-tauri`, мають ВЛАСНІ lock-файли) + спільний кореневий
Cargo.lock, якщо є (workspace-топологія).
- cleanupCargoBackups — Прибирає бекапи Cargo.toml/Cargo.lock після завершення (крок 7 SKILL.md,
Rust-гілка).

## Сценарії використання

- `plugins/lang-rust/taze/tests/provider.test.mjs` (rustProvider (форма контракту); buildCargoDependencyPrompt) — валідний EcosystemProvider за assertEcosystemProvider; available: cargo-edit відсутній → ok:false з причиною; available: cargo-edit є → ok:true; bump: per-manifest cargo upgrade --incompatible allow + cargo update (репо може не мати кореневого Cargo.toml); bump: провал команди → кидає з exit-кодом+stderr; ще 6

## Гарантії поведінки

- Свідомо пропускає шляхи: `node_modules`.
