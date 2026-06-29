---
type: JS Module
title: main.mjs
resource: npm/rules/docker/lint/main.mjs
docgen:
  crc: 244cdc8c
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Please provide the content of the file you want me to document. I need the code or at least the context file to proceed with generating the "Огляд" section based on the provided "Поведінка".

## Поведінка

Поведінка:
isDockerfileName визначає, чи є вказане ім'я файлу Dockerfile або Containerfile.
findDockerfilePaths збирає абсолютні шляхи до всіх Dockerfile / Containerfile, ігноруючи задані шляхи.
parseFromStages витягує всі інструкції `FROM <image>` з вмісту Dockerfile/Containerfile.
splitDockerfileStages розбиває вміст Dockerfile на логічні етапи на основі інструкцій `FROM`.
getMultistageAndRuntimeHint перевіряє, чи відповідає структура Dockerfile вимогам багатоетапної збірки та дозволених runtime-образів (docker.mdc).
getBunCompileHint перевіряє, чи для bun-проєктів на backend runtime виконується необхідна компіляція бінарника та не міститься залишків build tooling.
getNginxAlpineSlimTagHint перевіряє, що для nginx-образів у `FROM` вказано тег `alpine-slim` (docker.mdc).
getNonRootRuntimeHint перевіряє наявність інструкції `USER <non-root>` у фінальному stage (docker.mdc).
main виконує повний перегляд знайдених Dockerfile / Containerfile, застосовуючи перевірки, що спираються на конфіги, зокрема `package.json`, та запускаючи hadolint.
lint є оркестратором, який запускає `main` для перевірки усього репозиторію.

## Публічний API

isDockerfileName — визначає, чи є ім'я файлу Dockerfile або Containerfile (включаючи варіації типу `Dockerfile.prod`).
findDockerfilePaths — збирає повні шляхи до файлів Dockerfile або Containerfile, починаючи з поточного каталогу.
parseFromStages — витягує список усіх образів, вказаних у директивах `FROM` у файлі Dockerfile/Containerfile.
splitDockerfileStages — розділяє Dockerfile на логічні етапи (stages) на основі інструкцій `FROM`.
getMultistageAndRuntimeHint — аналізує вимоги до структури багатоетапного збігу: перевіряє, чи є мінімум два етапи з `FROM`, а також чи відповідають образи фінального етапу дозволеним типам (з урахуванням винятків для проєктів з нативними `.node-аддонами`).
getBunCompileHint — перевіряє, чи вимагає проєкт на backend runtime, що збірка збігається у бінарний файл.
getNginxAlpineSlimTagHint — для Nginx-образів перевіряє, чи вказано тег `alpine-slim` у відповідному `FROM`, згідно з `docker.mdc`.
getNonRootRuntimeHint — перевіряє, чи фінальний етап виконання використовує інструкцію `USER` для роботи від імені не-root користувача, згідно з `docker.mdc`.
main — проводить лінт-перевірку Dockerfile/Containerfile із використанням hadolint відповідно до `docker.mdc`.
lint — є адаптером, що викликає стандартний лінтер `n-cursor lint docker` для обгортання основної логіки.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
