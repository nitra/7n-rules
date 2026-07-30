---
type: JS Module
title: rule-meta-helpers.mjs
resource: npm/scripts/lib/rule-meta-helpers.mjs
docgen:
  crc: d3525004
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 80
---

## Огляд

Чисті хелпери конфігу/репо для автодетекту правил: id-міграції, нормалізація
списків, repository URL, monorepo-детект.

Винесені з `auto-rules.mjs`, щоб `rule-predicates.mjs` міг використати
`getRepositoryUrl` без циклу імпортів. `auto-rules.mjs` пізніше ре-експортує їх звідси.

## Публічний API

- RULE_MIGRATIONS — Карта міграції застарілих rule-id у `.n-rules.json` на актуальні.
Застосовується автоматично при читанні конфігу (як для `rules`, так і для `disable-rules`).
Приклад: `image` → `image-compress` + `image-avif` (правило розщеплене у 1.8.197).
- migrateRuleIds — Розгортає застарілі rule-id у списку згідно з `RULE_MIGRATIONS`. Зберігає порядок,
дедуплікує. Чистий хелпер: не мутує вхід, не логує.
- detectLegacyRuleIds — Повертає лише ті legacy rule-id зі списку, для яких є запис у `RULE_MIGRATIONS`.
Використовується для людинозрозумілого логування міграції при синхронізації CLI.
- normalizeIdList — Нормалізує список ідентифікаторів (trim + lowercase + унікальність збереженням порядку).
- getRepositoryUrl — Повертає URL репозиторію з package.json (`repository` може бути рядком або обʼєктом).
- isMonorepoPackage — Чи package.json виглядає як монорепо (поле `workspaces`).

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
