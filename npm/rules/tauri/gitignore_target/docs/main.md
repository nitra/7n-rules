---
type: JS Module
title: main.mjs
resource: npm/rules/tauri/gitignore_target/main.mjs
docgen:
  crc: c9fcfc58
  model: openai-codex/gpt-5.5
  score: 85
  issues: internal-name:findSrcTauriDirs,anchor-miss:(tauri.mdc),judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл read-only обходить усі `<ws>/src-tauri/` у монорепо спільним механізмом із `tauri/cargo_mutants_config` (`findSrcTauriDirs`), без дублювання обходу. Для кожного знайденого workspace корінний `ROOT_GITIGNORE = ".gitignore"` повинен містити точний запис `<ws>/src-tauri/target/`, звірений по точному рядку — typo на кшталт `owner/target/` (реальний інцидент у `nitra/task`) не рахується присутністю потрібного запису.

## Поведінка

- `MISSING_GITIGNORE_TARGET_ENTRIES` — reason `"missing-gitignore-target-entries"` для порушення, коли в корінному `.gitignore` бракує записів для Tauri build-артефактів.
- `ROOT_GITIGNORE` — назва корінного файлу `".gitignore"`, у якому мають бути всі очікувані ignore-записи.
- `expectedTargetEntry` — формує точний ignore-запис для `target/` конкретного `src-tauri/` відносно кореня монорепо.
- `findMissingEntries` — визначає, яких очікуваних ignore-записів немає у `.gitignore`, за точним збігом рядка (після trim).
- `lint` — read-only перевіряє всі знайдені `src-tauri/` у монорепо й повідомляє про відсутні ignore-записи одним violation на весь `.gitignore`.

## Публічний API

- MISSING_GITIGNORE_TARGET_ENTRIES — reason `missing-gitignore-target-entries` для випадків, коли в кореневому `.gitignore` немає записів для `src-tauri/target/`.
- ROOT_GITIGNORE — файл `.gitignore` у корені монорепо, який є єдиним місцем для цих ignore-записів.
- expectedTargetEntry — формує потрібний запис для ігнорування build-артефактів окремого workspace з `src-tauri/`.
- findMissingEntries — визначає, яких очікуваних записів бракує в кореневому `.gitignore`; збіг рахується лише для точного рядка після trim, тому `target/` або `owner/target/` не замінюють потрібний запис.
- lint — повідомляє про workspace з Tauri, для яких у кореневому `.gitignore` бракує `src-tauri/target/`.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Свідомо пропускає шляхи: `.git`.
