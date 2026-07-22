---
type: JS Module
title: main.mjs
resource: npm/rules/docker/lint/main.mjs
docgen:
  crc: 7cc8c2c7
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 90
  issues: internal-name:checkDockerfile,judge-refine:kept-original,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл знаходить Dockerfile і Containerfile в межах репозиторію через `findDockerfilePaths`, визначає stage-структуру через `splitDockerfileStages` і `parseFromStages`, а потім запускає `lint` як fail-safe перевірку без винесення винятків назовні.  
Перевірки спираються на правила з `docker.mdc` і окремо покривають multistage/runtime-узгодженість через `getMultistageAndRuntimeHint`, `getBunCompileHint`, `getNginxAlpineSlimTagHint` і `getNonRootRuntimeHint`, щоб Docker-образи відповідали очікуваній схемі збірки та запуску.

## Поведінка

Detector спочатку знаходить лише Dockerfile і Containerfile у межах репозиторію, відфільтровуючи імена через `isDockerfileName` та враховуючи ignore-маршрути, а далі для кожного файлу запускає послідовну перевірку в межах `lint`.

`parseFromStages` і `splitDockerfileStages` дають спільну картину структури файла: перший витягує всі базові образи, другий ділить вміст на stages, щоб наступні перевірки могли оцінювати саме фінальний runtime і build-stage окремо.

`getMultistageAndRuntimeHint` використовує ці дані, щоб вимагати multistage і дозволений фінальний runtime відповідно до `docker.mdc`; для bun-runtime робить виняток лише коли є нативний `.node`-аддон або явний `# n-rules:bun-no-compile` маркер. Такий маркер читає `hasBunNoCompileMarker`, і він служить opt-in для випадків, які не можна вивести механічно.

`getBunCompileHint` працює лише для bun-проєктів із backend runtime: якщо в образі є `bun install` або `bun i`, але немає compile-кроку в build-stage, або в фінальному stage лишився bun tooling, це вважається порушенням. Вимога спирається на `package.json`, щоб зрозуміти, чи проект справді bun-орієнтований.

`getNonRootRuntimeHint` перевіряє, що фінальний runtime не працює як root, а `getNginxAlpineSlimTagHint` звужує окреме правило для nginx-образів до потрібного тегу з `docker.mdc`.

Усі ці перевірки збираються в `checkDockerfile`, який для кожного знайденого файла формує violations і додає їх до результату через fail-safe підхід: помилки не виходять назовні, а перетворюються на контрольований lint-результат.

`lint` є єдиною точкою запуску для цього detector: вона знаходить файли, проганяє їх через `checkDockerfile` і повертає підсумок для всього репозиторію без запису стану.

## Публічний API

- isDockerfileName — Чи є basename Dockerfile / Containerfile (у т.ч. Dockerfile.prod).
- findDockerfilePaths — Збирає абсолютні шляхи до Dockerfile / Containerfile від кореня cwd.
- parseFromStages — Витягує всі `FROM <image>` зі вмісту Dockerfile/Containerfile.
- hasBunNoCompileMarker — Явний opt-in консюмера: коментар-рядок `# n-rules:bun-no-compile: <причина>` будь-де у файлі позначає, що `bun build --compile` неможливий з причини поза виявними класами (на відміну від нативних `.node`-аддонів, які виявляються з `package.json#dependencies`).
- splitDockerfileStages — Розбиває Dockerfile на stages за `FROM` (порожній масив, якщо FROM немає).
- getMultistageAndRuntimeHint — Перевіряє multistage (мінімум 2 FROM) і дозволений фінальний runtime-образ (docker.mdc); для нативного `.node`-аддона або `n-rules:bun-no-compile`-маркера додатково дозволяє `mirror.gcr.io/oven/bun:*`.
- getBunCompileHint — Для backend bun-проєкту (є `bun install`, фінальний FROM — alpine, не frontend, немає `n-rules:bun-no-compile`-маркера) вимагає `bun build --compile` у build stage і відсутність `bun` у фінальному stage.
- getNginxAlpineSlimTagHint — Перевіряє, що для nginx-образів (`mirror.gcr.io/nginxinc/nginx-unprivileged`) у `FROM` вказано тег `alpine-slim` (docker.mdc).
- getNonRootRuntimeHint — Перевіряє, що у фінальному stage є `USER <name|uid>` і це не `root`/`0` (docker.mdc).
- lint — Detector docker/lint: Dockerfile/Containerfile — mirror/multistage/runtime/non-root + hadolint.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
