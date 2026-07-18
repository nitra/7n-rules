---
type: JS Module
title: main.mjs
resource: npm/rules/nginx-default-tpl/template/main.mjs
docgen:
  crc: 1197df15
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

findDefaultConfTemplatePaths виявляє шляхи за замовчуванням для шаблонів конфігурації. migrateDefaultTplConfFiles та migrateErrorLogOffDirective відповідають за міграцію файлів конфігурації та відключення директиви журналювання помилок. parseIniVariableNames аналізує назви змінних з файлів в форматі INI. nginxTemplateViolations та httpRouteMatchesNginxDefaultTpl виявляють відповідності та порушення з шаблонами, за замовчуванням встановленими для Nginx. iniKeysMissingInTemplate перевіряє відсутність ключів INI у шаблоні. main — головна точка входу в функціональність. Система здатна звертатися до мережі, зберігає інформацію в пам'яті (кешування) протягом одного запуску та гарантує стабільність роботи через перехоплення помилок замість викидання винятків. Функціональність спирається на конфігурації extensions.json та settings.json.

## Поведінка

findDefaultConfTemplatePaths збирає абсолютні шляхи до `default.conf.template`, виключаючи тестові артефакти.
migrateDefaultTplConfFiles обробляє файли `default.tpl.conf` — або перейменовує їх у `default.conf.template`, або перезаписує існуючий шаблон їхнім вмістом.
migrateErrorLogOffDirective шукає `default.conf.template` та замінює в ньому невалідну директиву `error_log off;` на канонічний варіант `error_log /dev/null crit;`.
parseIniVariableNames витягує імена змінних з конфігураційних файлів формату `.ini` шляхом парсингу рядків `KEY=value`.
nginxTemplateViolations перевіряє вміст `default.conf.template` на відповідність набору стандартних правил, визначених у `nginx-default-tpl.mdc`.
httpRouteMatchesNginxDefaultTpl визначає, чи відповідає структура YAML-документа типу `HTTPRoute` необхідному патерну для відповідності `nginx-default-tpl.mdc`.
iniKeysMissingInTemplate перевіряє, чи всі імена змінних, знайдених у файлі `.ini`, використовуються як `$KEY` у конфігураційному шаблоні.
main виконує повний цикл перевірки відповідності проєкту стандартам `nginx-default-tpl.mdc`, включаючи обхід файлів, корекцію та валідацію.

## Публічний API

findDefaultConfTemplatePaths — Збирає всі шляхи до шаблону конфігурації за замовчуванням, ігноруючи тестові каталоги.
migrateDefaultTplConfFiles — Адаптує файли конфігурації з розширенням `.tpl.conf`, перетворюючи їх на шаблон `.conf.template` або замінюючи існуючий.
migrateErrorLogOffDirective — Виправляє некоректне використання `error_log off;` у шаблонах конфігурації, замінюючи його на надійний запис у `/dev/null`.
parseIniVariableNames — Витягує всі назви змінних з файлів у форматі `KEY=value`, виключаючи коментарі.
nginxTemplateViolations — Порівнює вміст основного шаблону конфігурації з вимогами, викладеними в `nginx-default-tpl.mdc`.
httpRouteMatchesNginxDefaultTpl — Визначає, чи відповідає конфігурація маршруту HTTP вимогам: повне збігання, що веде до HTTP-перенаправлення (301), плюс префікс шляху до бекенду на порту 8080.
iniKeysMissingInTemplate — Переконується, що всі визначені змінні з файлу ini присутні у шаблоні конфігурації як `$KEY`.
main — Проводить загальну перевірку проєктної конфігурації відповідно до правил `nginx-default-tpl.mdc`.

## Гарантії поведінки

- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- Кешує результати в межах одного прогону.
