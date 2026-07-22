---
type: JS Module
title: main.mjs
resource: npm/rules/tauri/cargo_mutants_config/main.mjs
docgen:
  crc: d73828f8
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 85
  issues: internal-name:getMonorepoPackageRootDirs,anchor-miss:(tauri.mdc),judge-refine:kept-original,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Read-only detector: лише звітує про відсутній або неповний `<ws>/src-tauri/.cargo/mutants.toml` і про відсутні канонічні Tauri-ключі. Для створення чи augment baseline використовується окремий T0-fix `fix-cargo_mutants_config.mjs`, а не detector. `lint --no-fix` ніколи не мутує дерево; спільні білдери baseline/append-блоку винесені для T0 через `buildAppended` і `buildBaseline`, а набір еталонних ключів задають `TAURI_CANONICAL_KEYS` і `TAURI_KEY_SNIPPETS`.

## Поведінка

findSrcTauriDirs відбирає лише ті workspace-корені, де є `src-tauri/Cargo.toml`, і саме ці каталоги стають входом для подальшої перевірки.

lint проходить по знайдених `src-tauri/` каталогах, для кожного звіряє наявність `.cargo/mutants.toml` і зводить результат у read-only звіт без змін у дереві.

detectMissingKeys порівнює наявний TOML із TAURI_CANONICAL_KEYS і повертає тільки відсутні канонічні ключі; порядок ключів у відповіді зберігається як у TAURI_CANONICAL_KEYS.

MUTANTS_CONFIG_MISSING позначає повністю відсутній конфіг; MUTANTS_KEYS_MISSING — наявний файл із неповним набором канонічних ключів.

TAURI_CANONICAL_KEYS визначає єдиний еталонний набір top-level ключів, а TAURI_KEY_SNIPPETS зберігає їхні канонічні текстові фрагменти; TAURI_BASELINE_HEADER задає верхівку повного baseline для нового файла.

buildBaseline збирає повний canonical `.cargo/mutants.toml` з TAURI_BASELINE_HEADER і всіма фрагментами з TAURI_KEY_SNIPPETS, а buildAppended додає тільки відсутні ключі до вже існуючого вмісту, не чіпаючи решту файла.

У звітах і підказках для виправлення використовується маркер ``, щоб пов’язати проблему з canonical Tauri-поведінкою та окремим T0-fix для baseline/augment.

## Публічний API

- MUTANTS_CONFIG_MISSING — Стабільний reason: файл mutants-конфігу відсутній узагалі.
- MUTANTS_KEYS_MISSING — Стабільний reason: mutants-конфіг є, але бракує канонічних Tauri-ключів.
- TAURI_BASELINE_HEADER — Шапка-коментар канонічного mutants-конфігу Tauri: пояснює, навіщо виключені збірки бінарника й doc-тестів.
- TAURI_KEY_SNIPPETS — Канонічні TOML-фрагменти по ключах mutants-конфігу — T0-fix дописує відсутній ключ саме цим текстом.
- TAURI_CANONICAL_KEYS — Перелік канонічних ключів, наявність яких перевіряється у mutants-конфігу Tauri-застосунку.
- findSrcTauriDirs — Знаходить усі `<ws>/src-tauri/` каталоги з власним `Cargo.toml` у монорепо.
Обходить workspace-пакети через `getMonorepoPackageRootDirs` (корінь + усі workspaces).
- detectMissingKeys — Зчитує існуючий `.cargo/mutants.toml` і повертає top-level ключі, яких ще немає.
- buildAppended — Будує append-блок з відсутніх ключів. Існуючий вміст не торкається.
- buildBaseline — Будує повний Tauri-canonical baseline (для випадку, коли файла ще немає).
- lint — запускає перевірку `mutants` для вказаного шляху, збирає результат у форматі, придатному для CI, і повертає помилку, якщо конфігурація або список ключів для перевірки відсутні.

`MUTANTS_CONFIG_MISSING="mutants-config-missing"` — означає, що для запуску не знайдено потрібний конфіг `mutants`.

`MUTANTS_KEYS_MISSING="mutants-keys-missing"` — означає, що не задано ключі, за якими треба виконати перевірку.

Поведінка враховує маркери повідомлень `tauri.mdc`: якщо вони присутні, результат прив’язується до них для подальшого показу в UI.

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
