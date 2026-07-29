---
type: JS Module
title: main.mjs
resource: npm/rules/doc-files/docgen-judge/main.mjs
docgen:
  crc: 6ac5333b
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл визначає налаштування `JUDGE_MODEL`, `JUDGE_ENABLED` і `JUDGE_CONFIDENCE` для LLM-оцінювання згенерованої документації та повертає verdict/fail щодо її семантичної придатності. `detectRefusalFiller` виявляє типові відмови або filler-фрази моделі, `parseDocVerdict` приймає структурований результат оцінювання, а `judgeMessages`, `judgeDoc` і `judgeFailsDoc` надають публічний шлях для перевірки тексту перед подальшим використанням.

## Поведінка

`JUDGE_ENABLED` визначає, чи має запускатися LLM-оцінювання документації, а `JUDGE_MODEL` і `JUDGE_CONFIDENCE` задають спільні межі для вибору моделі та довіри до verdict. Вхідний код і згенерована документація перетворюються через `judgeMessages` на повідомлення для судді; `judgeDoc` передає їх моделі та нормалізує відповідь через `parseDocVerdict`.

`parseDocVerdict` приймає лише структурований verdict із очікуваними полями, тому downstream-логіка працює не з довільним текстом LLM, а з перевіреним результатом. Якщо відповідь відсутня, не є коректним JSON або не відповідає схемі, оцінювання завершується помилкою замість мовчазного прийняття сумнівного результату.

`judgeFailsDoc` застосовує єдине правило деградації: документація вважається проблемною лише тоді, коли verdict позначає семантичну неточність із достатньою впевненістю. Це відокремлює слабкі або невизначені оцінки від рішень, які мають блокувати прийняття документації.

`detectRefusalFiller` працює як попередній захист якості машинних секцій: знаходить типові відмови або filler-фрази моделі, щоб такі тексти не потрапляли до документації як корисний зміст. Людський захищений розділ «Призначення» до цієї перевірки не входить.

## Публічний API

- JUDGE_MODEL — Модель-суддя = `N_CLOUD_MIN_MODEL` (хмарний cloud-min tier).
- JUDGE_ENABLED — Гейт активується АВТОМАТИЧНО, коли задано `N_CLOUD_MIN_MODEL` (без нього нема надійного судді).
- JUDGE_CONFIDENCE — Мін. впевненість, щоб verdict `inaccurate` позначив док як degraded.
- detectRefusalFiller — Шукає у тексті доки refusal/filler-фразу моделі.
- parseDocVerdict — Витягує й валідує verdict-JSON із сирої відповіді LLM (як `parseVerdict` у coverage-classify).
- judgeMessages — Messages для judge-виклику (винесено з [`judgeDoc`] для batch-хвилі
`docgen-wave-batch`: там суддя йде окремим `submitBatch`-викликом на всі
файли одразу, а не await тут-таки на кожен файл).
- judgeDoc — Судить згенерований док сильною моделлю проти джерела.
- judgeFailsDoc — Чи позначає verdict док як degraded (лише `inaccurate` із достатньою впевненістю).

## Сценарії використання

- `npm/rules/doc-files/docgen-judge/tests/docgen-judge.test.mjs` (parseDocVerdict; judgeFailsDoc) — витягує valid verdict з обрамленого тексту; нема JSON → throws; невідомий verdict → throws; confidence поза [0,1] → throws; inaccurate ≥ поріг → true; ще 9

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
