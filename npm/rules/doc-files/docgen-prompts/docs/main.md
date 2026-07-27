---
type: JS Module
title: main.mjs
resource: npm/rules/doc-files/docgen-prompts/main.mjs
docgen:
  crc: 2f8cf6ee
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Секція `overview` описує призначення файлу як джерела поведінкової документації для набору публічних генераторів і шаблонів. Вона фіксує, що `STYLE` і пов’язані з ним повідомлення формують узгоджений текст для огляду, критики, уточнення та одноразового запуску, а `buildUnitDigest` разом із `UNIT_DIGEST_TOKENS` підтримують стислий підсумок одиниці документації в межах одного прогону.

## Поведінка

STYLE задає єдиний стиль для побудови промптів і фінальних текстів: усі інші публічні точки орієнтуються на нього, щоб не роз’їжджалися формулювання, порядок секцій і межа між авторитетним контекстом та згенерованим текстом.

sectionMessages збирає секційні промпти з мінімальним контекстом і запускає основний цикл для «Поведінки»: бере facts, src, за потреби анкори й захищений контекст «Призначення», а для великого файлу може підставити стислий digest замість сирого source. Саме тут формується основа для LLM, але лише для behavior; «Огляд» іде окремим шляхом, а прочитаний intent не дублюється, а використовується як read-only межа.

isApiGap відсікає вже покриті описи експорту від справжніх прогалин, щоб LLM не переписував те, що вже має дослівний JSDoc-опис. Далі renderApiLine перетворює покриті експорти в готові рядки «Публічного API» без перефразування, а apiGapMessages готує вузький промпт лише для тих експортів, де опису нема або він порожній.

overviewMessages працює пізніше за секції: воно підсумовує вже написану «Поведінку», а не вигадує її з факт-листа заново. Завдяки цьому «Огляд» лишається узгодженим із фактичним текстом секції, а не стає generic-резюме; анкори сюди не додаються, щоб не дублювати їх двічі в одному документі.

criticMessages і refineMessages утворюють контрольний цикл для чорновиків секцій: спершу знаходять конкретні дефекти, потім переписують текст лише в межах знайдених зауважень. Обидві стадії спираються на facts і анкори, щоб правки лишалися прив’язаними до джерела, а не до абстрактного стилю.

guaranteesFromMarkers не залежить від LLM і виводить гарантії поведінки детерміновано з facts.markers, тому цей фрагмент не спотворюється моделлю. Це служить стабільною опорою для решти секцій і зменшує ризик generic-формулювань там, де зміст уже відомий із фактів.

oneShotMessages дає базовий одноразовий промпт для порівняння з секційним потоком: він також стартує від facts і src, але без розбиття на окремі стадії. Його результат корисний як контрольна точка, коли треба звірити якість розбитого сценарію з простішим baseline.

UNIT_DIGEST_TOKENS задає межу для компактного представлення великого файлу, щоб промпти не роздувалися до сирого source там, де це шкодить фокусу моделі. buildUnitDigest використовує цю межу як орієнтир і підміняє повний src структурованим дайджестом: так у промпт потрапляє достатньо контексту для поведінкових висновків без зайвого шуму.

judgeRefineMessages додає локальний repair-прохід після зовнішнього judge: коли є конкретне зауваження, воно йде прямо в refine-цикл як причина для точкового виправлення. Це дозволяє не перегенеровувати документ цілком, а адресно підчистити лише те, що суддя позначив як хибне.

## Публічний API

- STYLE — Спільний system-стиль для всіх docgen-промптів: вимагає лаконічну поведінкову
українську документацію, забороняє сигнатури/типи й мета-фрази перед відповіддю
(профілактика «озвучування завдання» малими моделями).
- sectionMessages — Секційні набори messages з МІНІМАЛЬНИМ контекстом під кожну секцію.
Код потрапляє лише в `behavior`; «Огляд» генерується окремо ОСТАННІМ
(`overviewMessages`) з уже написаної Поведінки — тут його немає. «Публічний
API» сюди більше не входить (Stage 1/3, гібрид doc-files ADR 260719-2155):
покриті JSDoc-описом експорти рендеряться дослівно без LLM (`renderApiLine`),
LLM викликається лише на прогалини (`apiGapMessages`) — див. `isApiGap`.
- isApiGap — Stage 2 (gap-детект, 0 токенів): чи є опис експорту прогалиною — відсутній
або JSDoc-заглушка без сенсу.
- renderApiLine — Stage 1 (скриптовий рендер, 0 токенів, 0 галюцинацій): дослівний рядок
«Публічного API» з покритого JSDoc-описом експорту — без перефразування LLM.
- apiGapMessages — Stage 3: messages ЛИШЕ для експортів-прогалин (без desc) — вужчий промпт,
ніж попередній «переписати весь список своїми словами» (жодного контакту з
уже покритими JSDoc експортами, 0 ризику спотворити авторський текст).
- overviewMessages — R3 — «Огляд» ОСТАННІМ: узагальнення вже написаної Поведінки, а не здогад із
голого факт-листа. Лікує generic/хибний Огляд на складних файлах.
Анкор-блок сюди НЕ підставляється (№8, бенч gemma-4): секції — окремі
LLM-виклики, і коли анкори бачили обидва, кожен чесно вставляв «рівно один
раз» → у документі виходило двічі (незграбні «посилаючись на…» в Огляді).
Анкори живуть лише в Behavior-промпті; скорер R5 перевіряє документ цілком.
- criticMessages — E2-step 1 — критик. Перевіряє чорнетку секції на конкретні дефекти.
Повертає messages для LLM-запиту: вихід має бути СПИСКОМ issues або словом NONE.
- refineMessages — E2-step 2 — refine. Переписує чорнетку, виправляючи перелічені issues.
- guaranteesFromMarkers — E3 — детермінований шаблон секції «Гарантії поведінки» з facts.markers.
НЕ використовує LLM: 0 запитів, 0 галюцинацій, 0 generic-фраз.
- oneShotMessages — One-shot messages (база для порівняння).
- UNIT_DIGEST_TOKENS — Поріг (у токенах, ~4 байти/токен), після якого сирий src замінюється юніт-дайджестом.
- buildUnitDigest — №5 (бенч gemma-4): стислий юніт-дайджест великого файлу замість сирого src у
Behavior-промпті. На ~6k токенів сирцю мала модель втрачає фокус (водянисті
формулювання); дайджест подає структуру — імʼя, JSDoc, call-graph, тіло лише
для непокритих JSDoc юнітів (перші рядки) — і тримає промпт компактним.
- judgeRefineMessages — №6 — judge-refine: один локальний refine-прохід за конкретними зауваженнями
LLM-судді (замість лише маркування degraded). Суддя вже сформулював, ЩО саме
хибне (`reason`) — мала модель добре виправляє точкові твердження, коли їй
сказано, які саме.

## Сценарії використання

- `npm/rules/doc-files/docgen-prompts/tests/docgen-prompts.test.mjs` — sectionMessages — Огляд більше не тут (R3)
- `npm/rules/doc-files/docgen-prompts/tests/docgen-prompts.test.mjs` — не повертає секцію overview
- `npm/rules/doc-files/docgen-prompts/tests/docgen-prompts.test.mjs` — Поведінка обмежена експортованими іменами (R6)
- `npm/rules/doc-files/docgen-prompts/tests/docgen-prompts.test.mjs` — Поведінка не отримує test evidence: сценарії рендерить JS окремою секцією
- `npm/rules/doc-files/docgen-prompts/tests/docgen-prompts.test.mjs` — гібридний режим просить доповнити comments лише відсутнім потоком
- `npm/rules/doc-files/docgen-prompts/tests/docgen-prompts.test.mjs` — overviewMessages — узагальнення Поведінки (R3)
- `npm/rules/doc-files/docgen-prompts/tests/docgen-prompts.test.mjs` — містить текст Поведінки і заборону generic-формул
- `npm/rules/doc-files/docgen-prompts/tests/docgen-prompts.test.mjs` — isApiGap — Stage 2 gap-детект (ADR 260719-2155)
- `npm/rules/doc-files/docgen-prompts/tests/docgen-prompts.test.mjs` — порожній desc → прогалина
- `npm/rules/doc-files/docgen-prompts/tests/docgen-prompts.test.mjs` — desc відсутній зовсім → прогалина
- `npm/rules/doc-files/docgen-prompts/tests/docgen-prompts.test.mjs` — JSDoc-заглушка «опис.» → прогалина
- `npm/rules/doc-files/docgen-prompts/tests/docgen-prompts.test.mjs` — змістовний desc → не прогалина
- `npm/rules/doc-files/docgen-prompts/tests/docgen-prompts.test.mjs` — renderApiLine — Stage 1 дослівний рендер (0 токенів)
- `npm/rules/doc-files/docgen-prompts/tests/docgen-prompts.test.mjs` — name — desc дослівно, без перефразування
- `npm/rules/doc-files/docgen-prompts/tests/docgen-prompts.test.mjs` — apiGapMessages — Stage 3, LLM лише для прогалин
- `npm/rules/doc-files/docgen-prompts/tests/docgen-prompts.test.mjs` — містить лише імена прогалин, без покритих сусідів
- `npm/rules/doc-files/docgen-prompts/tests/docgen-prompts.test.mjs` — buildUnitDigest — №5 стислий дайджест великого файлу
- `npm/rules/doc-files/docgen-prompts/tests/docgen-prompts.test.mjs` — покритий JSDoc юніт — без тіла (JSDoc достатньо)
- `npm/rules/doc-files/docgen-prompts/tests/docgen-prompts.test.mjs` — непокритий юніт — тіло обрізане до перших рядків з «…»
- `npm/rules/doc-files/docgen-prompts/tests/docgen-prompts.test.mjs` — шапка попереджає, що повний код не подано

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Кешує результати в межах одного прогону.
