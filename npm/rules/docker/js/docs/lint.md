---
type: JS Module
title: lint.mjs
resource: npm/rules/docker/js/lint.mjs
docgen:
  crc: bf935f19
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
---

Модуль аналізує файли `Dockerfile` та `Containerfile` у репозиторії, використовуючи `isDockerfileName` та `findDockerfilePaths` для ідентифікації конфігурацій. Він розбиває знайдені файли на етапи за допомогою `parseFromStages` та `splitDockerfileStages`. Модуль перевіряє конфігурацію, використовуючи `check` та `lint`, щоб оцінити відповідність стандартам, враховуючи дані з `package.json`. Він визначає інформацію про багатоетапну збірку, теги образів та права користувача, відповідно до вимог (docker.mdc).

## Поведінка

isDockerfileName визначає, чи є наданий шлях назвою Dockerfile або Containerfile.
findDockerfilePaths збирає відсортований список абсолютних шляхів до всіх Dockerfile/Containerfile, ігноруючи вказані шляхи каталогів.
parseFromStages витягує список усіх інструкцій `FROM <image>` з вмісту Dockerfile/Containerfile.
splitDockerfileStages розбиває вміст Dockerfile/Containerfile на окремі етапи (stages) на основі інструкцій `FROM`.
getMultistageAndRuntimeHint перевіряє, чи відповідає структура Dockerfile вимогам multistage build та дозволеним образам для фінального runtime (docker.mdc).
getBunCompileHint перевіряє, чи виконано необхідну компіляцію застосунку у бінарник для bun-проєктів, якщо фінальний образ — alpine (docker.mdc).
getNginxAlpineSlimTagHint перевіряє, чи використовується тег `alpine-slim` для nginx-образів (docker.mdc).
getNonRootRuntimeHint перевіряє, чи має фінальний stage інструкцію `USER <non-root>` для забезпечення не превілейованого образу (docker.mdc).
check перевіряє всі знайдені Dockerfile/Containerfile, виконуючи перевірки на відповідність стандартам, включаючи hadolint (docker.mdc).
lint оркеструє обхід репозиторію та викликає `check` для всіх знайдених Dockerfile/Containerfile.

## Публічний API

isDockerfileName — визначає, чи є файл `Dockerfile` або `Containerfile` у поточному каталозі.
findDockerfilePaths — збирає повні шляхи до файлів `Dockerfile` або `Containerfile` від кореня робочого каталогу.
parseFromStages — витягує всі образи, зазначені в інструкціях `FROM` у файлі.
splitDockerfileStages — розділяє вміст файлу на окремі етапи згідно з інструкціями `FROM`.
getMultistageAndRuntimeHint — оцінює відповідність структури файлу: мінімум два етапи `FROM` та відповідність базових образів списку дозволених у `docker.mdc` (з додатковим дозволом для `bun` у випадку нативного `.node-аддону`).
getBunCompileHint — перевіряє, чи вимагає проєкт на базі Bun компіляції в бінарний файл для бекенд-рантайму.
getNginxAlpineSlimTagHint — перевіряє, чи використовується тег `alpine-slim` для образів Nginx, як зазначено в `docker.mdc`.
getNonRootRuntimeHint — перевіряє, чи встановлено користувача, відмінного від `root` (не `0`), у фінальному етапі виконання, згідно з `docker.mdc`.
check — виконує статичний аналіз файлу `Dockerfile`/`Containerfile` за допомогою hadolint (`docker.mdc`).
lint — запускає стандартний лінтер для Docker-файлів через адаптер `n-cursor lint docker`.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
