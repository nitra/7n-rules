---
type: JS Module
title: inline-template-links.mjs
resource: npm/scripts/lib/inline-template-links.mjs
docgen:
  crc: dde8124c
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.96
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Перетворює markdown-лінки на файли з `template/` у fenced-блоки з фактичним вмістом цих файлів і додає знайдені `.mdc`-правила, щоб зібраний `.mdc` лишався самодостатнім для подальшого використання без відносних шляхів. Поведінку реалізують `inlineTemplateLinks` і `appendDiscoveredMdcFiles`.

## Поведінка

inlineTemplateLinks спочатку підбирає лише ті markdown-лінки, що ведуть у template-піддерево, і замінює їх самодостатнім вбудованим фрагментом із фактичним вмістом файлу; так правило перестає залежати від відносних посилань. Для вкладених прикладів і слот-файлів відновлюється читабельна назва цілі, зокрема для `package.json.snippet.json` і `package.json`, а формат fenced-блока обирається за розширенням вмісту. Якщо ціль не знайдено, обробка зупиняється з помилкою, щоб згенерований `.mdc` не містив битих посилань.

appendDiscoveredMdcFiles далі доповнює вже оброблений текст усіма знайденими `.mdc`-файлами з піддиректорій, які позначені через `concern.json`; це дає змогу зібрати повний пакет правил без ручного перелічення допоміжних файлів. Порядок стабільний: спочатку директори сортуються, потім файли всередині кожного каталогу, а результати додаються в кінець як один суцільний блок. Якщо таких директорій немає, початковий текст лишається без змін.

## Публічний API

- inlineTemplateLinks — Finds markdown links whose path contains /template/ and replaces them with
inline fenced blocks. Reads file from join(ruleDir, rel-path).
Throws Error if a matched link target doesn't exist (fail loud — user must know).
- appendDiscoveredMdcFiles — Appends all *.mdc files from concern subdirectories (those with concern.json).
Concerns ordered alphabetically; files within each concern ordered alphabetically.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
