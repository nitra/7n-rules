---
type: JS Module
title: main.mjs
resource: npm/rules/adr/hooks/main.mjs
docgen:
  crc: 306cc765
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 95
  issues: anchor-miss:(adr.mdc),judge-refine:kept-original,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`lint` перевіряє репозиторій на відхилення, які потрапляють у його зону відповідальності, і пропускає `.git` та `node_modules`. Результат може бути порожнім, якщо локальна fail-safe гілка поглинає проблему; інші помилки можуть виходити назовні.

## Поведінка

1. Перевіряє проєкт на відповідність правилам `adr.mdc` і збирає лише ті відхилення, які впливають на ADR-процес.
2. Окремо контролює наявність і канонічність hook-скрипта, налаштувань проєкту, Cursor hooks, правил ігнорування для логів та state-файлів, каталогу `docs/adr/`, а також доступність capture-бекенду.
3. Для hook-частини звіряє, що проєктні managed hooks і їхні логи покриті очікуваними шляхами, а `.gitignore` не дозволяє випадково версіонувати службові файли.
4. Для конфігурацій спирається на `settings.json`, `hooks.json`, `settings.local.json` і перевіряє, що локальні налаштування не дублюють спільні, а stop-hook присутній у потрібному місці.
5. Якщо потрібний бінарник недоступний, фіксує це як інформативний стан без блокування: capture залишається best-effort і може мовчки перейти в no-op.
6. Під час перевірок свідомо ігнорує `.git` та `node_modules`, щоб не змішувати службові артефакти з робочим станом репозиторію.
7.

## Публічний API

- lint — Перевіряє відповідність проєкту правилам adr.mdc.

## Сценарії використання

- `npm/rules/adr/hooks/tests/hooks.test.mjs` (check-adr (інтеграція); checkCaptureBackendAvailable — pi npm-first lookup) — 0 — повний валідний setup; 1 — capture-decisions.sh не канонічний; 1 — normalize-decisions.sh не канонічний; 1 — .cursor/hooks.json не має Cursor stop-hook для capture; 1 — .gitignore не покриває capture-decisions.log; ще 22

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
- Свідомо пропускає шляхи: `.git`, `node_modules`.
