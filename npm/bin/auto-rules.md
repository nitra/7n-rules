# Авто вмикання правил та скілів

В цьому файлі описані умови, по яким повинні скіли та правила автододаватись в конфіг

## Правила, які автоматично додається до .n-cursor.json

abie - якщо в кореневому package.json в секції "repository" присутній текст "<https://github.com/abinbevefes/**/>"

bun - якщо в корені проекту є package.json

docker - якщо в проекті є хоч один Dockerfile

ga - якщо присутня директорія .github/workflows

graphql - якщо хоч в одному js або vue файлі присутній gql` темплейт літерал

js-lint - якщо присутній хоч один js файл

js-pino - якщо присутній хоч один js файл, не в монорепо проекті з vue та директорії tempo

k8s - якщо присутня хоч одна директорія k8s

nginx-default-tpl - якщо присутній хоч один файл з переліку - default.conf.template, default.conf, nginx.conf

npm-module - якщо в корені присутня директорія npm

style-lint - якщо присутній хоч один vue або css файл

text - завжди

vue - якщо присутній хоч один vue файл

## Скіли, які автоматично додається до .n-cursor.json

abie-kustomize - якщо в кореневому package.json в секції "repository" присутній текст "<https://github.com/abinbevefes/**/>"

fix - завжди

lint - завжди

## Виключення

Якщо в .n-cursor.json задано в секції disable-rules правило, то воно автоматично додаватись не повинно.

Якщо в .n-cursor.json задано в секції disable-skills скіл, то він автоматично додаватись не повинен.
