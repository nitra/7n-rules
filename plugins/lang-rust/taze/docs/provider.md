---
type: JS Module
title: provider.mjs
resource: plugins/lang-rust/taze/provider.mjs
docgen:
  crc: 7955afa3
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Модуль супроводжує безпечне оновлення Rust-залежностей: `findCargoManifests` знаходить релевантні Cargo-файли репозиторію, свідомо пропускаючи `node_modules`, `backupCargoManifests` захищає їх копіями перед змінами, а `cleanupCargoBackups` прибирає ці копії після успішного завершення. `buildCargoDependencyPrompt` готує для LLM інструкцію щодо major-оновлення конкретного крейта, щоб оцінка сумісності спиралася на контекст репозиторію та дані, отримані через звернення до мережі.

## Поведінка

findCargoManifests визначає Rust-маніфести в репозиторії, свідомо оминаючи node_modules, робочі дерева й каталоги збірки, щоб подальше оновлення залежностей не зачіпало сторонній або тимчасовий код. Знайдені шляхи стають спільним списком для підготовки безпечних змін і фінального прибирання.

backupCargoManifests створює страхову копію маніфестів і відповідних lock-файлів перед змінами, включно з кореневим lock-файлом workspace. Це дозволяє оркестратору відновити стан після невдалого оновлення або перевірки.

buildCargoDependencyPrompt отримує вже підготовлений запис про major-оновлення одного Rust-крейта й формує інструкцію для LLM-ітерації. Текст спрямовує аналіз на поведінкову сумісність конкретної залежності, з урахуванням джерел на кшталт https://crates.io/crates/ і контексту репозиторію, зокрема package.json.

cleanupCargoBackups завершує потік після успішного проходження оновлення та перевірок: прибирає тимчасові копії тих самих Cargo-файлів, які були захищені на початку. Дані між кроками передаються через список знайдених маніфестів і записи про залежності; постійного спільного стану або кешування цей модуль не підтримує.

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

## Гарантії поведінки

- Свідомо пропускає шляхи: `node_modules`.
