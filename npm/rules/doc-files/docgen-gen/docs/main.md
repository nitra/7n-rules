---
type: JS Module
title: main.mjs
resource: npm/rules/doc-files/docgen-gen/main.mjs
docgen:
  crc: 3b1b2242
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 0
  issues: refusal-filler,internal-name:isApiGap,internal-name:renderApiLine,internal-name:commentOnlyDoc,internal-name:oneShotDoc,internal-name:orchestratedDoc,internal-name:finishUnsupported,anchor-miss:(abie.mdc)
---

## Огляд

Файл зберігає поведінкову документацію поруч із кодом і не дає перезаписати захищені фрагменти, включно з «Призначення». Він працює через послідовність `stripLeadingPreamble`, `splitProtected` і `insertProtected`, щоб відокремлювати керовані частини від людських вставок і повертати їх у фінальний текст без втрат.

Для побудови API-опису використовується `buildApiSection`, а повноту коментарної документації перевіряє `hasCompleteCommentDocumentation` разом із `commentDocumentationMode`. Якщо коментарів недостатньо, процес переходить до генерації через `generateDoc`; якщо достатньо, результат лишається в межах наявного контексту. Окремо додаються тестові сценарії через `insertTestScenarios`, щоб документація відображала очікувану поведінку в перевірках.

Оцінювання й відбір версій документа виконуються через `scoreDoc`, а пакетна обробка чернеток проходить через `prepareBatchItem` і `finishBatchItem`. Для модельного кроку використовується `DEFAULT_LOCAL_MODEL`, а кешування в межах одного прогону зменшує повторні обчислення для вже оброблених фрагментів.

## Поведінка

Генератор працює як послідовний конвеєр: спочатку обмежує доступний час виклику, потім читає файл, витягає факти й у разі наявності попередньої документації зберігає захищену секцію «Призначення». Далі потік розгалужується між comment-only, one-shot і orchestrated режимами, але в усіх випадках результат проходить через однакові етапи очищення, складання та оцінювання. Маркери повідомлень на кшталт `` мають лишатися дослівними як стабільні прив’язки до джерела.

`capTimeoutToDeadline` і `DEFAULT_LOCAL_MODEL` задають межі виконання та базову локальну модель, а `prepareBatchItem` використовує той самий preflight, що й `generateDoc`, але без LLM-виклику: він лише готує факти, анкори, сире джерело, режим і messages для batch-обробки. Якщо джерело завелике або не підтримується екстрактором, файл відсікається до старту генерації; якщо є повністю покриті авторські коментарі, `hasCompleteCommentDocumentation` дозволяє зібрати документ без моделі. `commentDocumentationMode` вибирає, чи достатньо лише коментарів, чи потрібне доповнення поведінки, а `generateDoc` уже на цій основі вирішує між `commentOnlyDoc`, `oneShotDoc`, `orchestratedDoc` і завершенням unsupported-шляху.

`splitProtected` та `insertProtected` керують незмінною секцією «Призначення» як окремим шаром поверх машинно згенерованого Markdown: вона вирізається з наявної доки перед обробкою і вставляється назад у фіксоване місце після складання. `stripLeadingPreamble` прибирає чат-преамбули, щоб модельний текст не збирав у документ службові фрази, а `insertTestScenarios` додає детерміновану секцію сценаріїв окремо від основного LLM-потоку. Це дозволяє зберігати людські вставки, не змішуючи їх із генерацією.

`buildApiSection` і `commentDocumentationMode` формують міст між авторським JSDoc і машинною документацією: якщо public API вже достатньо описаний, секція збирається без моделі; якщо лишаються прогалини, модель доповнює тільки їх. `scoreDoc` перевіряє зібраний документ проти фактів, а `generateDoc` використовує цей скоринг для деградованого стану та повторної спроби з іншим режимом, якщо якість нижча за поріг. `finishBatchItem` робить той самий фінальний крок для batch-результату, але без окремого judge-етапу, тому його вихід зберігає ту саму структуру й ті самі метрики, що й послідовний шлях.

## Публічний API

- capTimeoutToDeadline — Ріже базовий per-call таймаут під залишок бюджету до дедлайну.
Без дедлайну — базовий ліміт; після дедлайну — 0 (виклик не має стартувати).
- stripLeadingPreamble — R9: зрізає провідні чат-преамбули й дубль назви секції з початку тексту.
Ітерується, поки перший непорожній рядок лишається мета-нарацією — модель
інколи ставить дві поспіль («Як технічний письменник…» + «Ось оновлений…»).
- splitProtected — Відокремлює захищену секцію `## Призначення` (Варіант B). Межа — наступний `## `
(H2); `###`+ усередині не обривають блок.
- insertProtected — Вставляє захищений блок `## Призначення` одразу після H1 (фіксована позиція).
- scoreDoc — Stage 2.5 — детермінований скоринг (0 токенів): перевіряє вихід проти фактів.
- buildApiSection — Stage 1/3 (гібрид doc-files, ADR 260719-2155): «Публічний API» — покриті
JSDoc-описом експорти рендеряться дослівно (`renderApiLine`, 0 токенів, 0
галюцинацій), LLM викликається лише на прогалини (`isApiGap`). Якщо прогалин
немає — секція збирається БЕЗ жодного LLM-виклику. Єдиний непокритий
експорт (як і раніше) лишається описаним лише в Поведінці — окремого виклику
на секцію з одного рядка не варте.
- hasCompleteCommentDocumentation — Чи коментарі автора повністю покривають машинну документацію: header дає
«Огляд», а змістовні описи всіх public API — відповідну секцію. У такому
разі LLM не потрібна: текст зберігається дослівно для JS, Rust і Python.
- commentDocumentationMode — Вибирає гібридний режим для повністю прокоментованого source. Короткий
header майже напевно є pointer-ом, а середній header разом із явним flow у
коді потребує короткого LLM-доповнення. Детальний наратив лишається 0-LLM.
- insertTestScenarios — Додає test-сценарії до one-shot/batch-документа. Для unsupported мов основний
Markdown ще повертає LLM, але test-секція лишається виключно JS-рендером.
- DEFAULT_LOCAL_MODEL — Дефолтна модель: N_CURSOR_DOCGEN_MODEL → resolveModel('min') (→ N_LOCAL_MIN_MODEL).
Без хардкод-fallback: модель налаштовує кожен локально (`N_LOCAL_MIN_MODEL`); якщо
нічого не задано — порожньо, і preflight оркестратора фейлить гучно (а не шле
запит до неіснуючої моделі).
- generateDoc — Головний API: файл → md-дока з det-оцінкою.

Local-only (ADR 260610-2228): жодних cloud-ескалацій і pre-route — будь-який
файл генерується локальною моделлю. Якщо det-score нижче порогу, один retry
з вищою температурою (best-of-2); якщо й він не допоміг — результат
позначається `degraded`, рішення про перегенерацію приймає batch/користувач.
- prepareBatchItem — T8 (2b-batch, рішення Р): підготовка ОДНОГО item-у для `submitBatch` — та сама
pre-send guard і той самий факт-лист/one-shot messages, що й `oneShotDoc`/
`generateDoc`, але БЕЗ виклику LLM (виклик робить batch-шар одним `submit` на
всі файли разом). Кидає ту саму помилку pre-send guard, що й `generateDoc`
(класифікується `permanent` у batch-оркестраторі — skip, не помилка прогону).
- finishBatchItem — T8 (2b-batch): постобробка ОДНОГО результату `submitBatch` — той самий фініш,
що й `oneShotDoc`/`finishUnsupported`/det-скорер, тільки без LLM-виклику
(текст уже отримано з batch-у). Judge-гейт (Stage 3) у batch-шляху НЕ
викликається (мінімальний обсяг T8 — генерація; judge лишається опційним
розширенням послідовного шляху).

## Сценарії використання

- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — scoreDoc — R4 generic-overview
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — абстрактний Огляд штрафується і опускає score під поріг
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — конкретний Огляд не штрафується
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — scoreDoc — R6 витік службових імен
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — неекспортована функція у Поведінці → internal-name
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — scoreDoc — R5 анкор-покриття
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — пропущений валідний анкор → anchor-miss + штраф
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — наявний анкор → без штрафу
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — фейковий анкор (немає в src) не вимагається
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — scoreDoc — R7 суржик
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — русизм у тексті → surzhik
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — scoreDoc — еталон
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — чистий документ → 100, без issues
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — scoreDoc — R8 refusal/чат-філер (пре-гейт перед judge, issue #16)
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — «Я готовий писати… Надайте мені код» → refusal-filler, degraded попри валідну структуру
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — refusal-фраза лише в захищеному людському «Призначенні» → не штрафується
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — generateDoc — pre-send byte-guard
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — джерело понад бюджет → throw Prompt too long (skip, без LLM)
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — capTimeoutToDeadline — зріз per-call таймауту під дедлайн рунга
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — без дедлайну → базовий ліміт без змін
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — залишок до дедлайну менший за базовий → ріжеться до залишку
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — дедлайн у минулому → 0 (виклик не має стартувати)
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — залишок більший за базовий → базовий ліміт
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — generateDoc — deadline fix-pipeline
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — вичерпаний бюджет → transient-помилка «timeout» без LLM-виклику, chain закривається fail
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — splitProtected — захищена секція «Призначення» (Варіант B)
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — витягує тіло, межа на наступному H2; ### усередині не обриває
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — without прибирає блок, лишає машинні секції
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — немає секції → body=null, without=md без змін
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — insertProtected — вставка після H1
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — intent потрапляє між H1 і першою машинною секцією
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — порожній intent → без змін
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — roundtrip: insert → split повертає те саме тіло
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — scoreDoc — захищена секція виключена зі скорингу
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — суржик у «Призначення» НЕ штрафує
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — суржик у машинній секції — штрафує (контроль)
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — buildApiSection — Stage 1/3 гібрид (ADR 260719-2155): без LLM, коли немає прогалин
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — немає експортів → порожня секція, без виклику LLM
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — єдиний непокритий експорт → порожня секція (лишається у Поведінці)
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — усі експорти покриті JSDoc → дослівний рендер, 0 LLM-викликів
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — JSDoc-заглушка «опис.» вважається прогалиною (isApiGap): покритий рядок дослівно, прогалина — з LLM
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — stripLeadingPreamble — R9 чат-преамбули (живі приклади gemma-4, efes 2026-07-21)
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — «Ось оновлена чорнетка секції…» зрізається, контент лишається
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — «Як технічний письменник, я створю…» зрізається
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — дубль назви секції першим рядком («Поведінка:») зрізається
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — дві мета-рядки поспіль зрізаються обидві
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — звичайний текст без преамбули — без змін
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — текст, що ЛИШЕ з преамбули — порожній рядок (не сміття)
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — «Оглядає…»/«Створює…» на початку легітимного речення НЕ зрізаються (без false positive)
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — scoreDoc — R9 chat-preamble штраф
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — преамбула в машинній секції → chat-preamble, score падає
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — преамбула лише в захищеному «Призначенні» → не штрафується
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — чистий документ → без chat-preamble
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — prepareBatchItem / finishBatchItem — T8 2b-batch (без LLM-виклику)
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — prepareBatchItem: pre-send guard кидає ту саму помилку, що й generateDoc (без LLM)
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — prepareBatchItem: повертає facts/anchors/src/messages/intent для допустимого джерела
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — prepareBatchItem: захищена секція «Призначення» з наявної доки → intent
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — prepareBatchItem: comment-only не створює batch prompt
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — prepareBatchItem: comment+behavior відправляє лише вузький behavior prompt
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — finishBatchItem: unsupported + refusal-філер → score=0, degraded
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — finishBatchItem: unsupported + чистий текст → score=null, не degraded
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — finishBatchItem: det-скорер рахує score як і для orchestrated шляху (нижче порогу → degraded)
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — finishBatchItem: comment-only збирається без відповіді batch-моделі
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — insertTestScenarios — JS-рендер test evidence
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — додає окрему секцію перед гарантіями без інтерпретації LLM
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — замінює спробу LLM написати цю секцію детермінованим вмістом
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — orchestratedDoc / judge — supported-file happy path (мок extractFacts + runOneShot)
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — happy path: покритий API без LLM, критик NONE, суддя accurate → чистий success
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — повні авторські коментарі → документ збирається без жодного LLM-виклику
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — без header або з непокритим API лишається LLM fallback
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — короткий header з повним API → LLM лише для додаткової Поведінки
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — гібридний judge бачить тільки LLM-додаток, а не авторські секції
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — гібридний режим не створює порожню Поведінку, коли LLM повертає NONE
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — режим за header і flow: детальний наратив → comment-only, короткий → comment+behavior
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — buildApiSection: мікс покритий+прогалина → apiGap LLM лише на прогалину (без critique-refine, gap.length!==exps.length)
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — buildApiSection: усі експорти — прогалина → apiGap LLM + critique-refine (критик знайшов дефект)
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — best-of-2: перша спроба нижче порогу, ретрай кращий →
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — judge gate: inaccurate → judge-refine приймається (заголовки збережено, score не впав, повторний суддя accurate)
- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` — judge gate: inaccurate → judge-refine відхилено (рерайт губить заголовок) → лишається degraded

## Гарантії поведінки

- Кешує результати в межах одного прогону.
