---
type: JS Module
title: fix-package_json.mjs
resource: plugins/lang-js/rules/bun/package_json/fix-package_json.mjs
docgen:
  crc: cf834366
  model: openai-codex/gpt-5.4-mini
  score: 100
  issues: judge:inaccurate:0.97
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл знаходить `package.json` із порушеннями policy `bun/package_json` серед заборонених top-level полів і `scripts.lint` / `scripts.lint-*` та запускає T0-autofix для цих випадків. Він видаляє top-level поля за каноном `template/package.json.deny.json` і `package.json.deny.json`, а lint-скрипти переписує на канонічний `bunx n-rules lint ...` лише після репо-wide пошуку всіх їхніх викликів; нерозпізнані виклики лишаються без змін, і в такому разі скрипт не видаляється. Помилки обробляє fail-safe і не кидає назовні.

## Поведінка

1. `patterns` знаходить package.json, у яких є порушення policy для `bun/package_json`, і запускає T0-autofix лише для них.
2. Для кожного такого package.json вона орієнтується на канон deny-списку з `template/package.json.deny.json` і прибирає заборонені top-level поля.
3. Якщо в `package.json` є `scripts.lint` або `scripts.lint-*`, вона спершу шукає їхні виклики в репозиторії та переписує їх на канонічний `bunx n-rules lint ...`, щоб не зламати споживачів цих скриптів.
4. Власні скрипти цього ж `package.json` теж оновлюються до канонічного запуску, якщо вони посилаються на lint-скрипти, що плануються до видалення.
5. Скрипт видаляє `scripts.lint*` лише тоді, коли для них не лишається нерозпізнаних викликів; якщо десь є незрозумілий спосіб запуску, він лишає скрипт на місці й лише повідомляє про це.
6. Після змін вона записує оновлений `package.json` і повертає перелік зачеплених файлів та короткий підсумок змін; назовні помилки не пробиваються.

## Гарантії поведінки

- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
