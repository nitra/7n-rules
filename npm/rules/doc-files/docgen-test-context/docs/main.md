---
type: JS Module
title: main.mjs
resource: npm/rules/doc-files/docgen-test-context/main.mjs
docgen:
  crc: 7013a702
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Збирає підтверджені зв’язки між source-файлами та test/spec-файлами в один індекс, щоб для кожного source можна було показати пов’язані сценарії, а для кожного test — знайти відповідні source-файли. Підтримує лише вже підтверджені зв’язки й не переносить у документацію неперевірений test-код. Працює fail-safe: не пропускає помилки назовні та за окремих збійних ситуацій повертає порожнє значення замість винятку.

## Поведінка

buildTestEvidenceIndex збирає для репозиторію єдину карту зв’язків між source і test/spec-файлами, а isDocgenTestFile відсіює лише ті імена, які можуть бути окремими тестовими файлами для опису usage-сценаріїв. Зв’язок уважається доведеним тільки тоді, коли тест посилається на реальний source через relative string literal; записи без такого зв’язку не потрапляють до індексу. Якщо під час обходу або резолву трапляється помилка, обробка не падає назовні, а повертає порожній результат або null там, де це доречно.

testEvidenceForSource читає цей індекс для конкретного source і формує два виходи: список пов’язаних test-файлів із підтвердженими сценаріями та детермінований CRC payload. До payload потрапляють лише дані, потрібні для перевірки стабільності, а сам test-код у prompt не переноситься — у документацію йде лише дослівно підтверджена назва сценарію.

sourceFilesForTest працює у зворотному напрямку: з індексу бере всі source-файли, на які посилається конкретний test/spec, і повертає лише ті, що були підтверджені тим самим правилом relative reference до реального файлу.

renderTestScenarios отримує вже зібрані пов’язані test-файли зі сценаріями й детерміновано рендерить їх у Markdown-розділ «Сценарії використання». Джерелом назв є тільки підтверджені test/describe/it-назви, тому цей шар не додає нової поведінки від себе і не перефразовує її.

## Публічний API

- isDocgenTestFile — Чи шлях має форму окремого test/spec-файлу, який може описувати usage-сценарії.
Rust unit-тести всередині source-файлу вже входять до самого джерела.
- buildTestEvidenceIndex — Будує один source↔tests index на репозиторій. Зв'язок вважається доведеним
лише через relative string literal, що резолвиться у реальний файл.
- testEvidenceForSource — Формує дані для JS-рендеру сценаріїв і детермінований payload для CRC.
Test-код не потрапляє до LLM prompt: опис тестового usage лишається дослівним.
- renderTestScenarios — Детерміновано рендерить підтверджені тестами сценарії у Markdown. Назви
походять безпосередньо з `describe`/`test`/`it`, тому LLM не може їх
перефразувати або додати неіснуючу поведінку.
- sourceFilesForTest — Source-файли, на які посилається конкретний змінений test/spec-файл.

## Сценарії використання

- `npm/rules/doc-files/docgen-test-context/tests/main.test.mjs` — isDocgenTestFile
- `npm/rules/doc-files/docgen-test-context/tests/main.test.mjs` — розпізнає JS/TS test/spec і Python test naming
- `npm/rules/doc-files/docgen-test-context/tests/main.test.mjs` — звичайний source-файл не є тестом
- `npm/rules/doc-files/docgen-test-context/tests/main.test.mjs` — buildTestEvidenceIndex
- `npm/rules/doc-files/docgen-test-context/tests/main.test.mjs` — звʼязує source лише з тестом, що реально посилається на нього
- `npm/rules/doc-files/docgen-test-context/tests/main.test.mjs` — інший сценарій
- `npm/rules/doc-files/docgen-test-context/tests/main.test.mjs` — підтримує import без розширення і vi.mock relative reference
- `npm/rules/doc-files/docgen-test-context/tests/main.test.mjs` — не вважає shared test helper джерелом поведінки лише через import
- `npm/rules/doc-files/docgen-test-context/tests/main.test.mjs` — renderTestScenarios
- `npm/rules/doc-files/docgen-test-context/tests/main.test.mjs` — зберігає test-шлях і назву сценарію дослівно, без LLM-інтерпретації
- `npm/rules/doc-files/docgen-test-context/tests/main.test.mjs` — порожній набір сценаріїв не створює вміст секції
- `npm/rules/doc-files/tests/main.test.mjs` — lint — детект (read-only detector)
- `npm/rules/doc-files/tests/main.test.mjs` — ci (files=undefined): ловить відсутню доку у дереві
- `npm/rules/doc-files/tests/main.test.mjs` — ci: свіжа дока → 0 violations
- `npm/rules/doc-files/tests/main.test.mjs` — quick: змінене джерело без доки → violation; порожній набір → 0
- `npm/rules/doc-files/tests/main.test.mjs` — quick: реверс-мапінг — змінена дока веде до перевірки джерела
- `npm/rules/doc-files/tests/main.test.mjs` — quick: ігнорує test-файл без звʼязку із source
- `npm/rules/doc-files/tests/main.test.mjs` — quick: зміна повʼязаного тесту перевіряє й позначає stale доку source-файлу
- `npm/rules/doc-files/tests/main.test.mjs` — свіже дерево: stale не репортуються
- `npm/rules/doc-files/tests/main.test.mjs` — violation несе reason і шлях джерела у message
- `npm/rules/doc-files/tests/main.test.mjs` — плагін задекларований, але не встановлений (свіжий worktree без bun install) — 0 violations + warn-діагностика
- `npm/rules/doc-files/tests/main.test.mjs` — плагін встановлений — без діагностики, навіть якщо 0 violations

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
