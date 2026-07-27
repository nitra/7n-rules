---
type: JS Module
title: fix-licensee.mjs
resource: plugins/lang-js/rules/bun/licensee/fix-licensee.mjs
docgen:
  crc: 977cdf24
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 95
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Модуль утримує T0-autofix для `bun/licensee` у трьох патернах: `bun-licensee-config-init` створює відсутній `.licensee.json` через `licensee --init` і нормалізує канонічний SPDX-allowlist; `bun-licensee-canonical-policy` зберігає наявний `.licensee.json` і додає канонічно дозволені SPDX `ISC`, `BlueOak-1.0.0`, `0BSD` без стирання користувацьких полів; `bun-licensee-workspace-license-metadata` додає `"license": "ISC"` для власного package.json, коли `licensee` підтвердив `Invalid license metadata` і передав ім’я пакета у `violation.data.package`.  
Це потрібно, щоб безпечно виправляти власні Bun-workspace метадані без втручання в сторонні `license-violation`, які лишаються для окремого людського рішення.  
Якщо `.licensee.json` або `package.json` недоступний, локальні fail-safe гілки завершуються без змін.

## Поведінка

1. `patterns` застосовує T0-виправлення лише до канонічних ліцензійних проблем власного Bun-workspace: якщо `.licensee.json` має помилку метаданих ліцензії й це підтверджено звітом `licensee`, проставляє `"license": "ISC"` у відповідних workspace-пакетах.

2. Під час виправлення зберігає лише ті зміни, що реально потрібні для політики, і не чіпає сторонні `license-violation`, бо вони потребують окремого людського рішення.

3. Операції спираються на `.licensee.json` і `package.json`; якщо один із файлів відсутній або нечитабельний, локальна гілка безпеки просто завершує дію без часткового псування стану.

## Сценарії використання

- `plugins/lang-js/rules/bun/licensee/tests/fix-licensee.test.mjs` (bun-licensee-config-init pattern; bun-licensee-canonical-policy pattern) — test: true лише на licensee-config-missing; apply: генерує .licensee.json через licensee --init з усіма 7 канонічними SPDX; test: true лише на license-violation; apply: додає відсутні канонічні SPDX, зберігаючи packages/corrections/користувацькі spdx; apply: ідемпотентно — вже канонічний файл лишається без змін; ще 4

## Гарантії поведінки

- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
