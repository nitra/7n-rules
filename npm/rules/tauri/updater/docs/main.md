---
type: JS Module
title: main.mjs
resource: npm/rules/tauri/updater/main.mjs
docgen:
  crc: f85675d3
  model: openai-codex/gpt-5.4-mini
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`lint` читає конфігурації Tauri-застосунків у монорепо та перевіряє, що налаштування й залежності узгоджені між `tauri.conf.json` і `package.json`. Якщо під час перевірки трапляється помилка, вона не виходить назовні; результатом лишається fail-safe повідомлення без змін у файловій системі чи БД.

## Поведінка

1. `lint` знаходить у монорепо workspace-каталоги з Tauri-застосунком за наявністю `tauri.conf.json`.
2. Для кожного такого workspace перевіряє `package.json`: чи є `@7n/tauri-components` не нижче `0.8`, а також `@tauri-apps/plugin-updater` і `@tauri-apps/plugin-process` версії `2`.
3. Перевіряє `src-tauri/Cargo.toml`: чи присутній `tauri-plugin-process`, а `tauri-plugin-updater` оголошений лише для desktop-збірки.
4. Перевіряє `src-tauri/src/lib.rs`: чи зареєстровані `tauri_plugin_process` і `tauri_plugin_updater`, та чи updater під захистом desktop-умови.
5. Перевіряє `src-tauri/capabilities/*.json`: чи надані permissions `updater:default` і `process:allow-restart`.
6. Перевіряє `src/**/*.vue`: чи бодай один Vue-компонент використовує `useUpdater` з `@7n/tauri-components/vue`.
7. Перевіряє `src/main.{js,ts}` Quasar-застосунків: чи підключено плагін `Dialog` (імпорт з `quasar` і присутність у `plugins: {...}`) — без нього діалог оновлення від `useUpdater()` падає з `TypeError: e.dialog is not a function` мовчки, у `console.error`.
8. Якщо жодного Tauri-workspace не знайдено, `lint` завершується без зауважень.
9. Під час перевірок `lint` не змінює файлову систему і не кидає помилки назовні; усі порушення повертає як звіт.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
