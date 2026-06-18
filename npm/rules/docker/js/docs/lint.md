---
type: JS Module
title: lint.mjs
resource: npm/rules/docker/js/lint.mjs
docgen:
  crc: 495d03ee
  score: 100
---

Модуль забезпечує декомпозицію структури Dockerfile для вилучення даних про багатостадійні збірки та залежності середовища. Функції, такі як `findDockerfilePaths` та `splitDockerfileStages`, використовуються для ідентифікації та розділення стадій збірки. Модуль надає інструменти для отримання підказок про виконання, включаючи визначення багатостадійного режиму (`getMultistageAndRuntimeHint`), компіляційних налаштувань (`getBunCompileHint`), та підказок про використання образу Nginx Alpine Slim (`getNginxAlpineSlimTagHint`). Додатково, він визначає необхідність роботи без прав root (`getNonRootRuntimeHint`). (docker.mdc)

## Поведінка

isDockerfileName
Перевіряє, чи є вхідний рядок назвою Dockerfile або Containerfile.

findDockerfilePaths
Збирає абсолютні шляхи до Dockerfile або Containerfile від заданого кореня репозиторію, враховуючи виключені шляхи.

parseFromStages
Витягує інструкції FROM з вмісту файлу.

splitDockerfileStages
Розбиває вміст Dockerfile на окремі стадії на основі інструкцій FROM.

getMultistageAndRuntimeHint
Перевіряє, чи має Dockerfile мінімум дві інструкції FROM і чи є фінальний образ дозволеним runtime-образом (docker.mdc).

getBunCompileHint
Перевіряє наявність інструкцій `bun install` та відсутності `bun build --compile` для виявлення необхідності компіляції бінарника (docker.mdc).

getNginxAlpineSlimTagHint
Перевіряє, чи містить інструкція FROM для образу nginx потрібний тег `alpine-slim` (docker.mdc).

getNonRootRuntimeHint
Перевіряє, чи присутня інструкція USER у фінальній стадії і чи не використовується `root` або `0` для запуску (docker.mdc).

check
Запускає перевірки Dockerfile через hadolint, включаючи перевірки multistage, компіляції, non-root, тегів nginx та загальну валідацію.

readNearestDependencies
Читає залежності з найближчого package.json, розташованого у каталогах Dockerfile або вище.

checkDockerfile
Перевіряє індивідуальний Dockerfile/Containerfile на наявність інструкцій, пов'язаних з mirror.gcr.io, multistage, компіляції, non-root, тегів nginx та виконує перевірку через hadolint.

## Публічний API

isDockerfileName — перевіряє наявність файлів `Dockerfile` або `Containerfile` у назві.
findDockerfilePaths — збирає повні шляхи до файлів `Dockerfile` або `Containerfile` від поточної робочої директорії.
parseFromStages — витягує всі інструкції `FROM <image>` з вмісту файлів.
splitDockerfileStages — розділяє файл `Dockerfile` на послідовні етапи за інструкціями `FROM`. Повертає порожній масив, якщо інструкції `FROM` відсутні.
getMultistageAndRuntimeHint — перевіряє вимоги до структури Dockerfile:
  multistage — вимагає мінімум два етапи `FROM`.
  фінальний FROM — перевіряє, чи дозволений образ у `docker.mdc` (alpine, scratch, debian slim, php, python, nginx, openresty, тощо). Для проєктів з нативним .node-аддоном дозволено `mirror.gcr.io/oven/bun:*` (bun-рантайм).
getBunCompileHint — перевіряє наявність вимоги "компіляції в бінарник" для bun-проєктів на бекенд-рантаймах.
Тригер — перевіряє, чи присутній крок `bun install` або `bun i` у Dockerfile.
Тригер — перевіряє, чи фінальний образ — `mirror.gcr.io/library/alpine:*` (виключаючи фронтенд nginx/openresty).
getNginxAlpineSlimTagHint — перевіряє, чи містить `FROM` для nginx-образу (`mirror.gcr.io/nginxinc/nginx-unprivileged`) тег `alpine-slim` (`docker.mdc`).
getNonRootRuntimeHint — перевіряє вимогу "non-root" у фінальному runtime-етапі (`docker.mdc`).
Очікування — перевіряє, чи містить build stage інструкцію `bun build --compile`.
Очікування — перевіряє, чи відсутні виклики `bun` у фінальному етапі (залишкові інструменти збірки).
Очікування — перевіряє, чи містить фінальний етап інструкцію `USER <name|uid>`.
Очікування — перевіряє, чи користувач у фінальному етапі не є `root` і не дорівнює `0`.
check — виконує перевірку через hadolint (`docker.mdc`).

## Гарантії поведінки

- Read-only: файл не виконує операцій запису у файлову систему.
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За невдалої перевірки повертає `false`/`null` замість винятку.
- Не звертається до мережі.
