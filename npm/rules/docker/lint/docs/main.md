---
type: JS Module
title: main.mjs
resource: npm/rules/docker/lint/main.mjs
docgen:
  crc: f862652b
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`findDockerfilePaths` знаходить шляхи до Dockerfile/Containerfile в межах репозиторію, а `splitDockerfileStages` і `parseFromStages` дають уявлення про stages та runtime stage. На цій основі `getMultistageAndRuntimeHint`, `getBunCompileHint`, `getNginxAlpineSlimTagHint` і `getNonRootRuntimeHint` перевіряють відповідність очікуваному runtime-образу, способу запуску та структурі multistage. `lint` об’єднує ці перевірки для Dockerfile і працює fail-safe: перехоплює помилки та не пропускає винятки назовні.

## Поведінка

lint спочатку знаходить усі Dockerfile/Containerfile під коренем репозиторію, відсікаючи виключені каталоги, а далі для кожного файла проганяє набір перевірок поверх його вмісту. Для класифікації імен і розбиття документа на stages використовує parseFromStages разом із isDockerfileName та splitDockerfileStages, щоб відрізняти фінальний runtime stage від build stage і бачити структуру multistage.

Перевірки спираються на правила з docker.mdc і на найближчий package.json: саме з нього беруться залежності, щоб зрозуміти, чи дозволений bun runtime як фінальний образ. hasBunNoCompileMarker дає явний opt-in, коли статично довести можливість compile неможливо, а getMultistageAndRuntimeHint поєднує цю ознаку з аналізом фінального FROM і вимогою multistage. getBunCompileHint звіряє, що bun-проєкт із backend runtime має очікуваний compile-прохід і не тягне bun tooling у фінальний stage. getNginxAlpineSlimTagHint і getNonRootRuntimeHint застосовуються до фінального runtime stage, щоб зафіксувати потрібний nginx alpine-slim тег і запуск не від root.

Результати всіх перевірок збираються в один потік порушень і повертаються через lint без падіння назовні: помилки ловляться fail-safe, а сам детектор лише читає файли та метадані й не виконує власних записів.

## Публічний API

- isDockerfileName — Чи є basename Dockerfile / Containerfile (у т.ч. Dockerfile.prod).
- findDockerfilePaths — Збирає абсолютні шляхи до Dockerfile / Containerfile від кореня cwd.
- parseFromStages — Витягує всі `FROM <image>` зі вмісту Dockerfile/Containerfile.
- hasBunNoCompileMarker — Явний opt-in консюмера: коментар-рядок `# bun-no-compile: <причина>` будь-де у файлі позначає, що `bun build --compile` неможливий з причини поза виявними класами (на відміну від нативних `.node`-аддонів, які виявляються з `package.json#dependencies`).
- splitDockerfileStages — Розбиває Dockerfile на stages за `FROM` (порожній масив, якщо FROM немає).
- getMultistageAndRuntimeHint — Перевіряє multistage (мінімум 2 FROM) і дозволений фінальний runtime-образ (docker.mdc); для нативного `.node`-аддона або `bun-no-compile`-маркера додатково дозволяє `mirror.gcr.io/oven/bun:*`.
- getBunCompileHint — Для backend bun-проєкту (є `bun install`, фінальний FROM — alpine, не frontend, немає `bun-no-compile`-маркера) вимагає `bun build --compile` у build stage і відсутність `bun` у фінальному stage.
- getNginxAlpineSlimTagHint — Перевіряє, що для nginx-образів (`mirror.gcr.io/nginxinc/nginx-unprivileged`) у `FROM` вказано тег `alpine-slim` (docker.mdc).
- getNonRootRuntimeHint — Перевіряє, що у фінальному stage є `USER <name|uid>` і це не `root`/`0` (docker.mdc).
- lint — Detector docker/lint: Dockerfile/Containerfile — mirror/multistage/runtime/non-root + hadolint.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
