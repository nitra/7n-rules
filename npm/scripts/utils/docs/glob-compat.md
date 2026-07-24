---
type: JS Module
title: glob-compat.mjs
resource: npm/scripts/utils/glob-compat.mjs
docgen:
  crc: 0c6af731
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл забезпечує runtime-нейтральний glob-обхід для коду, що має працювати і під Bun, і під Node. Це потрібно, щоб імпорт модуля не падав у hook-сценаріях, які запускаються через `npx` у Node, де глобал `Bun` не визначений і top-level `new Bun.Glob` ламає завантаження модуля. Вибір механізму обходу відбувається за середовищем виконання: `Bun.Glob` під Bun, `node:fs/promises#glob` під Node (`node >=25`). Публічні точки файлу — `resolveGlobScan` і `hasIgnoredPathSegment`; друга відсікає шляхи через службові теки перед подальшою обробкою.

## Поведінка

`resolveGlobScan` уніфікує результат сканування glob перед подальшою ітерацією: якщо `Bun.Glob.scan` повертає Promise, він дочікується розв’язання, якщо вже повертає async-iterable — передає його далі без змін. Це прибирає різницю між середовищами виконання й дозволяє наступним крокам працювати з одним форматом даних.

`hasIgnoredPathSegment` застосовує спільне правило відсікання службових тек до відносних шляхів, щоб результати glob-обходу не потрапляли в обробку, якщо шлях проходить через одну з ігнорованих тек. Перевірка працює по сегментах шляху, тож однаковий результат дає і для Unix-, і для Windows-розділювачів.

Разом ці функції формують потік: сканування дає сирі збіги, `resolveGlobScan` стабілізує форму їх повернення, а `hasIgnoredPathSegment` відсікає небажані шляхи до передачі результатів далі. Поведінка узгоджується з очікуваннями, закладеними в `package.json`.

## Публічний API

- resolveGlobScan — Розрізняє дві форми повернення `Bun.Glob#scan()`: async-iterable напряму
(macOS) або Promise, що резолвиться в async-iterable (спостережено на
self-hosted Linux Bun 1.3.14 — `yield*` на Promise падає з "is not async
iterable", бо в Promise немає ні `Symbol.asyncIterator`, ні `Symbol.iterator`).
- hasIgnoredPathSegment — Чи містить відносний шлях сегмент зі службових тек, які glob-обхід має ігнорувати.
Еквівалент колишніх ignore-патернів `**\/<dir>/**` по кожній теці з `ignoredDirs`.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
