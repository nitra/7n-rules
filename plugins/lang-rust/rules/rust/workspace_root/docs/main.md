---
type: JS Module
title: main.mjs
resource: plugins/lang-rust/rules/rust/workspace_root/main.mjs
docgen:
  crc: 26e18c57
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`lint` — read-only detector рівня T0 для перевірки Rust workspace без `cargo spawn`: він шукає порушення кореневого контракту репозиторію через `NESTED_WORKSPACE`, `NESTED_PROFILE`, `MISSING_ROOT_WORKSPACE` і `PACKAGE_NOT_WORKSPACE_MEMBER`, а також повертає `lint`-report про структурні розриви. Це потрібно, щоб тримати Rust-структуру в одному кореневому workspace за аналогією з JS-каноном `root package.json` + `workspaces` + один lockfile. Авто-fix тут свідомо не застосовується: fixability лише `structural`, бо перенесення файлів і lockfile є ризикованим. Перевірка працює fail-safe, не кидає винятків назовні і за окремих помилок повертає порожнє значення (`null`) замість exception.

## Поведінка

`lint` запускає повну перевірку дерева Rust-manifest’ів від кореня репозиторію, спираючись на `package.json` як на точку входу для репозиторних правил. Спочатку він знаходить усі `Cargo.toml`, далі читає кожен маніфест і розрізняє кореневий workspace та звичайні package-manifest’и. Якщо в не-кореневих маніфестах є власні workspace- або profile-настройки, це фіксується як `NESTED_WORKSPACE` і `NESTED_PROFILE`. Якщо кореневий `Cargo.toml` не містить workspace, це фіксується як `MISSING_ROOT_WORKSPACE`. Після цього перевіряється, чи всі package-manifest’и входять до кореневого workspace; ті, що не покриті, позначаються як `PACKAGE_NOT_WORKSPACE_MEMBER`.  

`NESTED_WORKSPACE` і `NESTED_PROFILE` описують структурні порушення в підманіфестах: репозиторій має бути зібраний навколо одного кореневого workspace, без розпорошених workspace/profile-визначень у вкладених пакетах. `MISSING_ROOT_WORKSPACE` позначає відсутність цього центрального кореневого workspace. `PACKAGE_NOT_WORKSPACE_MEMBER` означає, що окремий package-manifest існує в дереві, але не входить до оголошеного набору workspace members, тобто випадає з єдиної кореневої Rust-структури.  

Усі результати лишаються у форматі report-only: модуль не виправляє структуру репозиторію автоматично, бо таке виправлення може вимагати перенесення файлів і змін lockfile. Помилки читаються fail-safe: невалідні або недоступні маніфести не валять перевірку назовні, а просто зводяться до відсутності даних для репорту.

## Публічний API

- NESTED_WORKSPACE — Стабільні reasons для чотирьох типів порушення.
- NESTED_PROFILE — позначає робочий простір як вкладений профіль, щоб цей стан можна було однозначно розпізнати в подальшій обробці.
- MISSING_ROOT_WORKSPACE — сигналізує, що в проєкті не знайдено кореневий workspace, без якого неможливо продовжити операцію.
- PACKAGE_NOT_WORKSPACE_MEMBER — повідомляє, що package не входить до складу workspace і тому не може брати участь у workspace-операціях.
- lint — запускає перевірку узгодженості правил для змінених файлів і допомагає не пропустити порушення перед змінами.

Експортовані константи-рядки: NESTED_WORKSPACE="nested-workspace"; NESTED_PROFILE="nested-profile"; MISSING_ROOT_WORKSPACE="missing-root-workspace"; PACKAGE_NOT_WORKSPACE_MEMBER="package-not-workspace-member" — стабільні ідентифікатори для різних станів workspace, щоб код і зовнішні перевірки спиралися на однакові значення.

Конфіг, на який спирається код: package.json — джерело workspace-структури та пов’язаних налаштувань, від яких залежить поведінка перевірок.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
