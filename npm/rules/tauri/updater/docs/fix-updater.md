---
type: JS Module
title: fix-updater.mjs
resource: npm/rules/tauri/updater/fix-updater.mjs
docgen:
  crc: 7c4598dc
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`patterns` — це T0-autofix для `tauri/updater`, який приводить canonical updater-configs до узгодженого стану через `package.json`, `updater.json` і `default.json`: синхронізує updater-related залежності, desktop-scoped plugin-налаштування, `#[cfg]`-guard над уже наявним рядком реєстрації та `capabilities/*.json` permissions за очікуваним контрактом Tauri. Публічні функції працюють fail-safe: перехоплюють помилки, не кидають винятків назовні й за окремих збоїв повертають порожнє значення, наприклад `null`, замість exception. Autofix свідомо не покриває `lib-rs-process-missing`, `lib-rs-updater-missing` і `use-updater-not-called`: ці cases лишаються manual, бо потребують structural fix у чужому builder-ланцюжку або SFC і не мають deterministic insertion point.

## Поведінка

1. `patterns` запускає набір T0-autofix-правил для `tauri/updater` лише тоді, коли знайдено релевантні порушення у workspace Tauri-додатка.
2. Для `package.json` воно приводить залежності до канонічного стану: додає або оновлює `@7n/tauri-components`, `@tauri-apps/plugin-updater`, `@tauri-apps/plugin-process`.
3. Для `Cargo.toml` воно гарантує наявність `tauri-plugin-process` і `tauri-plugin-updater`, а також тримає updater-плагін у desktop-scoped секції, щоб конфіг відповідав очікуванням Tauri для desktop-збірки.
4. Для `lib.rs` воно ставить `#[cfg]` безпосередньо над уже наявним рядком реєстрації `tauri_plugin_updater::Builder`, щоб updater вмикався лише на desktop.
5. Для `capabilities/updater.json` воно забезпечує permission `updater:default`; якщо файла ще немає, створює його з канонічним baseline.
6. Для `capabilities/default.json` воно забезпечує permission `process:allow-restart`; якщо файла ще немає, створює його з канонічним baseline.
7. Воно працює fail-safe: не викидає винятки назовні, а в проблемних місцях повертає порожній результат або пропускає зміну.
8. Воно свідомо не виправляє `lib-rs-process-missing` і `lib-rs-updater-missing`, бо там треба вставляти новий `.plugin` у довільний builder-ланцюжок без надійної детермінованої точки вставки.
9. Воно свідомо не виправляє `use-updater-not-called`, бо це потребує редагування чужого SFC і може зламати існуючі imports.

## Гарантії поведінки

- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
