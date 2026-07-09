---
type: JS Module
title: main.mjs
resource: npm/rules/tauri/release/main.mjs
docgen:
  crc: f903737f
  model: openai-codex/gpt-5.4-mini
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`lint` перевіряє готовність Tauri-застосунків у репозиторії до release-потоку на основі `tauri.conf.json` і `latest.json`. Він дає змогу зосередити перевірку на релізних налаштуваннях Tauri, не зачіпаючи `.github` та `.git`.

## Поведінка

1. `lint` знаходить усі workspace-каталоги з Tauri-застосунками, пропускаючи `.github` і `.git`, та бере до уваги лише репозиторії, де є `tauri.conf.json`.
2. Для кожного такого застосунку `lint` перевіряє готовність `tauri.conf.json` до release: чи увімкнено генерацію updater-артефактів, чи задано public key для updater і чи endpoint веде на `latest.json`.
3. `lint` контролює наявність `changelog-release.yml` як точки запуску release-процесу з changelog-змін, щоб релізи стартували від змін у `.changes`.
4. `lint` перевіряє, що `changelog-release.yml` реагує на push у відповідні `.changes`-шляхи для знайдених застосунків, має ручний запуск і захищений від повторного запуску release-циклом.
5. `lint` перевіряє, що `changelog-release.yml` має достатні права для запуску release-потоку та диспатчу наступного workflow.
6. `lint` контролює наявність `release.yml` як основного каналу збірки й публікації release-артефактів.
7. `lint` перевіряє, що `release.yml` запускається на тегах `v*`, підтримує ручний запуск і синхронізує версію в `tauri.conf.json` до кроку публікації через Tauri.
8. `lint` не змінює файли, працює read-only і повертає результат у fail-safe режимі: помилки фіксуються як порушення, а не пробиваються назовні винятками.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- Свідомо пропускає шляхи: `.github`, `.git`.
