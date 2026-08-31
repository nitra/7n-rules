---
bump: minor
section: Changed
---

`tauri/release` більше не JS: T0-фікс концерну портовано нативно (`crates/rules-core/src/concerns/fix_tauri_release.rs`), ключ доданий у `NATIVE_FIXES`, JS-канон знято.

Разом із портом спільний крейт `rules-template-merge` дістав `try_surgical_seq_insert` — вставку елемента в YAML-послідовність на ПОЗИЦІЮ зі збереженням форматування. Мерж уміє лише дописати в кінець, а тут порядок і є змістом: крок синхронізації версії мусить стояти перед `tauri-apps/tauri-action`, інакше версію синхронізовано вже після збірки.

Два дефекти канону полагоджено, а не відтворено заради парності: побитий `tauri.conf.json` і недосяжний format-preserving шлях тепер гучні помилки, а не тихі «нічого не змінено».

Деталі — §2.97 `docs/plans/2026-08-05-open-questions-register.md`.
