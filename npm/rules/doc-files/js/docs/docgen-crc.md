---
type: JS Module
title: docgen-crc.mjs
resource: npm/rules/doc-files/js/docgen-crc.mjs
docgen:
  crc: 0c277bb7
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
  issues: judge:inaccurate:0.99
  retried: true
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Please provide the code file you want me to generate the "Огляд" (Overview) documentation for. I need the content of the file to summarize its role based on the provided "Поведінка" section.

## Поведінка

Поведінка
QUALITY_THRESHOLD — Визначає поріг якості для документації, нижче якого вона вважається неякісною.
crc32 — Обчислює CRC32 вмісту, повертаючи його у форматі hex.
parseDocFrontmatter — Видобуває метадані з блоку YAML у заголовку MD-файлу та повертає тіло файлу.
buildDocFrontmatter — Створює YAML-блок для заголовка документації з інформацією про джерело, CRC та оцінку якості.
stampDoc — Формує фінальний MD-документ, замінюючи його старий заголовок новим, згідно з наданою оцінкою.
readDocCrc — Зчитує значення CRC32, збережене у заголовку MD-документа.
readDocQuality — Зчитує оцінку якості (score, issues, retried, judgeModel) з заголовка MD-документа.
readDocModel — Зчитує повний ідентифікатор моделі-генератора, збережений у заголовку MD-документа.
staleness — Визначає, чи є MD-документ застарілим порівняно з його вихідним кодом на основі порівняння CRC.

## Публічний API

- QUALITY_THRESHOLD — Встановлює поріг якості; документи з нижчим балом вважаються неякісними.
- crc32 — Генерує CRC32 вмісту у hex-форматі (8 символів), використовуючи нативний модуль `node:zlib.crc32`.
- parseDocFrontmatter — Зчитує метадані з початку файлу. Якщо метадані відсутні, повертає null для даних і весь текст у тілі.
- buildDocFrontmatter — Формує блок метаданих, сумісний з OKF, включаючи початкові OKF-поля та вкладені дані про генерацію (CRC/модель/якість).
- stampDoc — Додає необхідні метадані до документа, фіксуючи його стан та дані генерації.
- readDocCrc — Зчитує збережений CRC з метаданих документа; повертає null, якщо метадані відсутні або CRC не знайдено.
- readDocQuality — Зчитує оцінку якості, збережену в метаданих документа.
- readDocModel — Зчитує назву моделі, яка генерувала документ, із метаданих; повертає null, якщо поле не визначено (для старих документів).
- staleness — Визначає актуальність документа порівняно з його джерелом: відсутність, розбіжність CRC або свіжий статус.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
