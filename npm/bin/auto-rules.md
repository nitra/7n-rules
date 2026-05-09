# Авто вмикання правил

В цьому файлі описані умови, по яким повинні правила автододаватись в конфіг. Умови автододавання скілів — у `auto-skills.md` (виносить логіку зі словника правил у пару «правило → скіл»).

## Правила, які автоматично додається до .n-cursor.json

Синтаксис `rule - [other]` означає: правило `rule` варто автододати лише якщо всі правила у списку `[other]` вже додані до конфігу (граф залежностей між правилами; умова не дублюється).

abie - якщо в кореневому package.json в секції "repository" присутній текст "<https://github.com/abinbevefes/**/>"

bun - якщо в корені проекту є package.json

capacitor - якщо в проекті є хоч один файл capacitor.config.json

changelog - [bun]

docker - якщо в проекті є хоч один Dockerfile

ga - якщо присутня директорія .github/workflows

graphql - якщо хоч в одному js або vue файлі присутній gql` темплейт літерал

hasura - якщо в директорії присутній config.yaml, який містить рядок `metadata_directory: metadata`

image-compress - [bun]

image-avif - [vue, image-compress]

js-lint - якщо присутній хоч один js файл

js-run - якщо це вкладена директорія з package.json (не в корені) та в devDependencies немає vite

js-mssql - якщо в хоч одному package.json в секції dependencies присутній пакет mssql

js-bun-db - якщо в хоч одному package.json в секції dependencies присутній пакет pg, pg-format або mysql2 або є імпорт sql/SQL з Bun (приклад: import { sql } from "bun")

js-bun-redis - якщо в хоч одному package.json в секції dependencies присутній пакет ioredis або node-redis

k8s - якщо присутня хоч одна директорія k8s

nginx-default-tpl - якщо присутній хоч один файл з переліку - default.conf.template, default.conf, nginx.conf

npm-module - якщо в корені присутня директорія npm

php - якщо в корені є composer.json

rego - якщо в проекті є хоч один rego

style-lint - якщо присутній хоч один vue або css файл

text - завжди

vue - якщо присутній хоч один vue файл

## Виключення

Якщо в .n-cursor.json задано в секції disable-rules правило, то воно автоматично додаватись не повинно.
