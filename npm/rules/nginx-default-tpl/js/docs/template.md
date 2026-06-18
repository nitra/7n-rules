---
type: JS Module
title: template.mjs
resource: npm/rules/nginx-default-tpl/js/template.mjs
docgen:
  crc: 2d912e28
  score: 90
---

Надає повну перевірку проєкту, включаючи перевірку шаблонів, Dockerfile та конфігурацій VSCode.

## Поведінка

findDefaultConfTemplatePaths
Збирає абсолютні шляхи до default.conf.template

migrateDefaultTplConfFiles
Перейменовує або перезаписує default.tpl.conf у default.conf.template

migrateErrorLogOffDirective
Замінює невалідну директиву error_log off; на error_log /dev/null crit;

parseIniVariableNames
Витягує імена змінних з рядків у форматі KEY=value

nginxTemplateViolations
Перевіряє вміст шаблону на відповідність вимогам nginx-default-tpl.mdc

httpRouteMatchesNginxDefaultTpl
Перевіряє відповідність структури HTTPRoute до прикладу у nginx-default-tpl.mdc

iniKeysMissingInTemplate
Перевіряє, чи використовуються всі імена змінних з ini у шаблоні

check
Виконує повну валідацію проєкту включаючи перевірку шаблонів, Dockerfile та конфігурацій VSCode

## Публічний API

findDefaultConfTemplatePaths — Збирає повні шляхи до **default.conf.template** у репозиторії; виключає будь-який сегмент `fixtures/` (включаючи `tests/fixtures/` та ко-локальні шляхи `rules/<rule>/js/<concern>/fixtures/`).
migrateDefaultTplConfFiles — Знаходить **default.tpl.conf** у дереві від `root`. Якщо **default.conf.template** відсутній, перейменовує **default.tpl.conf**; якщо він присутній, перезаписує **default.conf.template** вмістом **default.tpl.conf** та видаляє **default.tpl.conf**.
migrateErrorLogOffDirective — Замінює невалідну директиву `error_log off;` на `error_log /dev/null crit;` у всіх **default.conf.template** від `root**. `error_log off;` трактується як ім'я файлу (`/etc/nginx/off`), що призводить до помилки `readOnlyRootFilesystem`. `/dev/null` — це записуваний пристрій.
parseIniVariableNames — Витягує імена змінних з файлів ini (рядки у форматі KEY=value, без коментарів і порожніх).
nginxTemplateViolations — Перевіряє вміст **default.conf.template** на відповідність вимогам **nginx-default-tpl.mdc**.
httpRouteMatchesNginxDefaultTpl — Перевіряє, чи відповідає **HTTPRoute** патерну Exact→RequestRedirect + PathPrefix→backendRefs.
iniKeysMissingInTemplate — Перевіряє, чи входять усі імена ключів з ini до шаблону у форматі `$KEY` (використовуючи envsubst).
check — Перевіряє відповідність проєкту правилам **nginx-default-tpl.mdc**.

## Гарантії поведінки

- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За невдачі повертає значення помилки (`false`/`null`/`Err`) замість генерування винятку чи паніки.
- Кешує результати в межах одного прогону.
- Не звертається до мережі.
