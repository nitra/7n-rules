---
type: JS Module
title: fix-release.mjs
resource: npm/rules/tauri/release/fix-release.mjs
docgen:
  crc: f18c9232
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.97
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`patterns` вмикає T0-autofix для вже наявних канонічних файлів релізного потоку Tauri: `tauri.conf.json`, `changelog-release.yml` і `release.yml`. Він робить лише детерміновані доповнення до цих файлів на основі `tauri.conf.json` і `latest.json`, щоб привести їх до релізного канону для GitHub Releases через `https://github.com/`. Не створює `*-workflow-missing` і не обробляє `*-invalid-yaml`, `tauri-conf-invalid-json` або `updater-pubkey-missing`: ці стани потребують ручного розв’язання, а `release.yml` і `changelog-release.yml` містять проєкт-специфічні значення, які не варто вигадувати автоматично.

## Поведінка

1. `patterns` запускає цільові T0-autofix-и лише для вже наявних канонічних файлів і працює fail-safe: помилки всередину не пробиває, а відсутні або некоректні чернетки просто лишає без змін.
2. Для `tauri.conf.json` доповнює updater-канон: вмикає створення updater-артефактів і додає endpoint на `latest.json` у GitHub Releases через `https://github.com/…`, якщо репозиторій походить з поточного `origin`.
3. Для `changelog-release.yml` добудовує релевантні release-умови лише тоді, коли файл уже існує й коректно читається: додає тригер по `.changes/**`, `workflow_dispatch`, захист від небажаного запуску та потрібні permissions.
4. Для `release.yml` добудовує release-канон лише тоді, коли файл уже існує й коректно читається: додає теговий тригер `v*`, `workflow_dispatch` і крок синхронізації версії з тегу перед `tauri-action`.
5. Не створює з нуля відсутні workflow-файли і свідомо не автолікує чернетки з некоректним YAML/JSON та `updater-pubkey-missing`; ці випадки залишає для ручного розв’язання.
6. Кожен автозастосунок повторно читає поточний вміст, тому зміни залишаються ідемпотентними: повторний запуск не дублює вже доданий канон.

## Гарантії поведінки

- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
