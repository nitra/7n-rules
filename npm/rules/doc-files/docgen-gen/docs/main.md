---
type: JS Module
title: main.mjs
resource: npm/rules/doc-files/docgen-gen/main.mjs
docgen:
  crc: a5710594
  model: omlx/gemma-4-e2b-it-4bit
  tier: local-min
  score: 5
  issues: no-overview,short-behavior,internal-name:isApiGap,internal-name:renderApiLine,internal-name:oneShotDoc,internal-name:finishUnsupported,anchor-miss:(foo.mdc),anchor-miss:(abie.mdc)
---

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

- `npm/rules/doc-files/docgen-gen/tests/docgen-gen.test.mjs` (scoreDoc — R4 generic-overview; scoreDoc — R6 витік службових імен) — абстрактний Огляд штрафується і опускає score під поріг; конкретний Огляд не штрафується; неекспортована функція у Поведінці → internal-name; пропущений валідний анкор → anchor-miss + штраф; наявний анкор → без штрафу; ще 58

## Гарантії поведінки

- Кешує результати в межах одного прогону.
