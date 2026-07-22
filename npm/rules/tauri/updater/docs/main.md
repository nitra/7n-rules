---
type: JS Module
title: main.mjs
resource: npm/rules/tauri/updater/main.mjs
docgen:
  crc: 98c501bd
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл відповідає за fail-safe lint Tauri updater-сценарію в знайдених робочих просторах застосунків: через `findTauriAppWorkspaces` і `lint` перевіряє конфігурацію, залежності, Rust/Cargo-секції, permissions і frontend entrypoints. `MIN_TAURI_COMPONENTS_VERSION` задає мінімальну очікувану версію Tauri-компонентів, а `CARGO_TARGET_SECTION_RE` допомагає розпізнавати релевантні Cargo-секції. Перевірка потрібна, щоб виявляти неповне або некоректне підключення updater без зупинки виконання через винятки назовні.

## Поведінка

`lint` запускає fail-safe перевірку Tauri updater-конфігурації: знаходить застосунки через `findTauriAppWorkspaces`, читає `tauri.conf.json`, `package.json`, Cargo, Rust, capabilities та Vue/Quasar entrypoints, після чого повертає структурований результат із pass/fail-повідомленнями замість винятків.

`findTauriAppWorkspaces` визначає workspace-и, де є Tauri-конфігурація, і саме цей список задає межі всіх подальших перевірок. Для кожного знайденого workspace-а `lint` послідовно звіряє JS-залежності, Rust-залежності, реєстрацію плагінів, permission-и, наявність виклику updater-хука та підключення Quasar Dialog, щоб гарантувати не лише встановлені пакети, а й видимий користувачу сценарій оновлення.

`MIN_TAURI_COMPONENTS_VERSION` задає мінімально прийнятну версію UI-компонентів updater-а; `meetsMinVersion` використовує нижню межу версійного діапазону для перевірки цього мінімуму, а `hasMajor` окремо контролює очікувану major-лінійку залежностей.

Для Cargo-перевірок `groupCargoDepsBySection` перетворює вміст маніфеста на секційний контекст, а `findSectionDeclaring` визначає, у якій секції оголошена потрібна залежність. `CARGO_TARGET_SECTION_RE` і `CARGO_MOBILE_SECTION_RE` відокремлюють платформні секції від загальних, щоб updater/process-залежності не потрапляли в мобільний або неправильний target-контекст. `CARGO_DESKTOP_TARGET_HEADER="target.\"` позначає desktop target-секцію Cargo, у якій очікуються desktop-специфічні залежності.

`collectCapabilityPermissionIds` збирає permission-ідентифікатори з capability-файлів workspace-а, після чого `lint` перевіряє наявність дозволів, потрібних для перевірки оновлень і перезапуску застосунку. Результати всіх підперевірок агрегуються в один lint-висновок без запису у файлову систему і без спільного стану між workspace-ами.

## Публічний API

- MIN_TAURI_COMPONENTS_VERSION — Мінімально допустима версія tauri-plugin-updater-сумісних компонентів (major, minor, patch).
- CARGO_TARGET_SECTION_RE — Розпізнає target-специфічну секцію залежностей у Cargo.toml.
- CARGO_MOBILE_SECTION_RE — Розпізнає мобільну (Android/iOS) target-секцію — updater там не потрібен.
- CARGO_DESKTOP_TARGET_HEADER — Канонічний заголовок desktop-only секції залежностей, куди має потрапити updater-плагін.
- findTauriAppWorkspaces — Знаходить workspace-каталоги з Tauri-застосунком (`<ws>/src-tauri/tauri.conf.json` чи legacy `<ws>/tauri.conf.json`).
- meetsMinVersion — Чи нижня межа `range` >= `min` (порівняння major.minor.patch).
- hasMajor — Чи мажорна версія `range` дорівнює очікуваній.
- groupCargoDepsBySection — Групує рядки Cargo.toml за заголовком секції `[...]` для контекстного пошуку залежностей.
- findSectionDeclaring — Знаходить назву секції Cargo.toml, що оголошує задану залежність.
- collectCapabilityPermissionIds — Збирає всі permission-ідентифікатори з `capabilities/*.json` workspace-каталогу.
- `lint` — знаходить некоректно оформлені параметри `path` у Tauri/Cargo desktop-налаштуваннях і підказує, де очікується узгодження з конфігами `tauri.conf.json` та `package.json`.

Експортована константа-рядок `CARGO_DESKTOP_TARGET_HEADER="target.\"` позначає початок desktop-секції Cargo target, щоб правило відрізняло платформні налаштування від загальних.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
