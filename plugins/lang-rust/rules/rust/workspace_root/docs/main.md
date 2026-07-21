---
type: JS Module
title: main.mjs
resource: plugins/lang-rust/rules/rust/workspace_root/main.mjs
docgen:
  crc: b4ed2ae4
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Read-only detector T0 без spawn `cargo`: перевіряє, що в репозиторії є рівно один кореневий Rust workspace, узгоджений із контрактом репозиторію на рівні `package.json` і одного кореневого workspace. Показує лише порушення; авто-фікс не робить, бо виправлення структурні й ризиковані. Помилки перехоплює, назовні винятки не кидає, а в окремих випадках повертає порожнє значення на кшталт `null`.

`NESTED_WORKSPACE` — позначка вкладеного workspace.  
`NESTED_PROFILE` — позначка вкладеного profile.  
`MISSING_ROOT_WORKSPACE` — позначка відсутнього кореневого workspace.  
`PACKAGE_NOT_WORKSPACE_MEMBER` — позначка package, що не входить до workspace membership.

## Поведінка

- NESTED_WORKSPACE — позначає порушення, коли в не-кореневому `Cargo.toml` знайдено вкладений `[workspace]`, щоб тримати рівно один кореневий Rust workspace.
- NESTED_PROFILE — позначає порушення, коли `[profile.*]` винесено поза кореневий `Cargo.toml`, бо профілі мають жити в одному місці.
- MISSING_ROOT_WORKSPACE — позначає порушення, коли в репозиторії є Rust package-маніфести, але немає кореневого `Cargo.toml` з `[workspace]`.
- PACKAGE_NOT_WORKSPACE_MEMBER — позначає порушення, коли `Cargo.toml` пакета не покрито кореневим `workspace.members` або `workspace.exclude`.
- lint — перевіряє дерево репозиторію на один кореневий Rust workspace, читає `Cargo.toml` у fail-safe режимі, пропускає `.git` і `node_modules`, і лише репортить порушення без змін у файловій системі.

## Публічний API

- NESTED_WORKSPACE — Стабільні reasons для чотирьох типів порушення.
- NESTED_PROFILE — позначає випадок, коли запитаний профіль належить вкладеному workspace, а не кореневому.
- MISSING_ROOT_WORKSPACE — сигналізує, що для пакета не знайдено кореневий workspace, на який він мав би спиратися.
- PACKAGE_NOT_WORKSPACE_MEMBER — повідомляє, що пакет не входить до складу жодного workspace у конфігурації.
- lint — запускає перевірку шляхів і залежності від `package.json`, щоб виявити невідповідності між параметрами, workspace-структурою та очікуваним розташуванням пакетів.

- `package.json` — джерело workspace-конфігурації, на яку спирається код під час визначення належності пакетів і профілів.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
- Свідомо пропускає шляхи: `.git`, `node_modules`.
