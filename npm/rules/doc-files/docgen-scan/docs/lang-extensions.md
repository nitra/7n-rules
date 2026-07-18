---
type: JS Module
title: lang-extensions.mjs
resource: npm/rules/doc-files/docgen-scan/lang-extensions.mjs
docgen:
  crc: 3c5bc28b
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Збирає з активних плагінів у репозиторії мапу розширень doc-files і мовні екстрактори для них, щоб інші частини системи могли підготувати обробку файла за доступними плагінними можливостями. `pluginDocFilesExtensions` формує перелік підтримуваних doc-files розширень, `loadDocFilesExtractors` підтягує екстрактори мов із плагінів, а `clearDocFilesLangCache` скидає кеш у межах прогону. Спирається на `.n-rules.json` і `.n-cursor.json` як джерело конфігурації активних плагінів та їхніх правил. Працює fail-safe: биті handler-модулі мовчки пропускає, не кидає винятків назовні, кешує стан у межах прогону.

## Поведінка

- `pluginDocFilesExtensions` — повертає мапу розширень doc-files, які декларують активні плагіни в репозиторії, з урахуванням кешу для поточного прогону.
- `loadDocFilesExtractors` — завантажує мовні екстрактори з handler-модулів плагінів для doc-files і повертає їх за розширеннями; биті модулі мовчки пропускає, тож для таких файлів далі можливий whole-file шлях.
- `clearDocFilesLangCache` — скидає внутрішній кеш мовних розширень і екстракторів, щоб наступний прогін прочитав актуальний стан заново.

## Публічний API

- pluginDocFilesExtensions — збирає з активних плагінів карту розширень для doc-files і тримає її в процесному кеші; порожній результат означає, що жоден плагін не оголосив підтримку.
- loadDocFilesExtractors — підвантажує мовні extractors із plugin handler-модулів для extension-point `doc-files`; якщо модуль зламаний, його тихо пропускає і далі обробляє файл цілком.
- clearDocFilesLangCache — очищає кеші, щоб тести починали з чистого стану.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- Кешує результати в межах одного прогону.
