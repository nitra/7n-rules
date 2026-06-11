---
docgen:
  source: npm/rules/abie/lib/env-dns.mjs
  crc: 91aa8ee4
---

# env-dns.mjs

## Огляд

Файл перевіряє конфігураційні файли середовища (`*.dev.env`, `*.ua.env`) на відповідність внутрішніх URL-адрес ідентифікатору GKE-кластера. Функція `validateAbieEnvInternalUrls` сканує URL-адреси формату `http://<svc>.<ns>.<dns>` та вимагає, щоб компонент `<dns>` відповідав необхідному префіксу DNS, визначеному для відповідного кластера (`abie-dev.internal` або `abie-ua.internal`).

## Поведінка

abieEnvNameFromBasename
Дістає тип середовища dev або ua з імени файлу. Файл без імені повертає null.

validateAbieEnvInternalUrls
Сканує вміст файлу на наявність внутрішніх URL. Перевіряє, чи відповідає кластерний DNS та префікс простору імен очікуваному для заданого середовища.

collectAbieEnvFiles
Збирає файли середовища abie, які відповідають правилам іменування. Виключає файли без імені.

## Публічний API

- abieEnvNameFromBasename — Витягує `dev` або `ua` з імені env-файлу.
- validateAbieEnvInternalUrls — Виявляє розбіжності кластерного DNS/namespace у внутрішніх URL-адресах.
- collectAbieEnvFiles — Збирає `.env` файли, що відповідають формату abie env (dev.env, ua.env, з провідною крапкою).

## Гарантії поведінки

- Read-only: файл не виконує операцій запису у файлову систему.
- Не звертається до мережі.
