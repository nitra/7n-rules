---
type: JS Module
title: docker-hadolint.mjs
resource: npm/rules/docker/lib/docker-hadolint.mjs
docgen:
  crc: ebab2135
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 90
---

## Огляд

Спільна логіка виклику hadolint для шляхів до Dockerfile. Модуль створює стандартизовані відносні шляхи з прямими слешами. Він ініціює перевірку Dockerfile, використовуючи hadolint як нативний бінарник, який резолвиться через `ensureTool` (PATH → кеш → авто-install brew/scoop/GitHub Release per-platform). Для отримання інформації про встановлення можна звертатися до https://github.com/hadolint/hadolint/releases. Публічна функція `lintDockerfileWithHadolint` виконує перевірку за правилом `n-cursor lint docker` / check-docker.

## Поведінка

posixRel
Створює відносний шлях від кореня з використанням прямих слешів.

lintDockerfileWithHadolint
Запускає hadolint як нативний бінарник для перевірки Dockerfile. Якщо не вдається знайти hadolint, повертає помилку з інструкцією для встановлення (наприклад, https://github.com/hadolint/hadolint/releases).

## Публічний API

* posixRel — Генерує абсолютний шлях від кореня з використанням лише слешів, забезпечуючи стабільність незалежно від операційної системи.
* lintDockerfileWithHadolint — Запускає інструмент hadolint для аналізу Dockerfile. Якщо інструмент не знайдено у системних шляхах, він намагається встановити його. У разі невдачі встановлення або відключення автоматичного встановлення, повертає помилку, надаючи користувачеві підказку для ручного запуску (детальніше про інструмент можна знайти на https://github.com/hadolint/hadolint/releases).

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
