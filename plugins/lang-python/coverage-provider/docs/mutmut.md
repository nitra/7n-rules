---
type: JS Module
title: mutmut.mjs
resource: plugins/lang-python/coverage-provider/mutmut.mjs
docgen:
  crc: b8bdf31b
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл перетворює текстовий вивід mutmut 4.x у дані контракту CoverageRow: `mutmut results --all true` з рядками `<ім'я мутанта>: <статус>` дає підсумок score, а `mutmut show <name>` із заголовком `# name: <статус>` і unified diff дає деталі окремого мутанта. Score рахується так: `caught = killed + timeout`, знаменник — `caught + survived`, а `suspicious/skipped/no tests` не входять у знаменник.

Публічні функції `parseMutmutResults` і `parseMutantShow` утворюють чистий текстовий шар між командами mutmut і coverage-звітом, без запуску процесів чи запису даних.

## Поведінка

`parseMutmutResults` приймає текст результатів mutmut як перший етап потоку покриття: відокремлює мутанти, що впливають на score, рахує спіймані й загальні випадки та повертає імена тих, що survived, для подальшого детального перегляду.

`parseMutantShow` використовується для кожного survived-мутанта з попереднього етапу: приймає текст детального diff-виводу mutmut і перетворює його на дані про файл, рядок та зміну, придатні для формування рядка coverage-звіту.

Обидві функції працюють лише з уже отриманим текстом команд mutmut, не запускають зовнішні процеси й не записують дані. Спільне правило потоку — suspicious, skipped і no tests не входять у знаменник score, тому деталізуються лише survived-мутанти, які реально впливають на підсумкову оцінку.

## Публічний API

- parseMutmutResults — Розбирає вивід `mutmut results --all true` на лічильники score і список
імен survived-мутантів (для подальшого `mutmut show`).
- parseMutantShow — Розбирає вивід `mutmut show <name>`: шлях джерела з рядка `---`, позиція
зміненого рядка як старт hunk-а плюс індекс першого рядка тіла, що
починається з `-`, оригінал/заміна — вміст `-`/`+`-рядків без префікса.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
