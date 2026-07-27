---
type: JS Module
title: main.mjs
resource: npm/rules/doc-files/docgen-scan/main.mjs
docgen:
  crc: 9db666fe
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл сканує дерево проєкту й класифікує стан сусідньої поведінкової документації в `docs/` без власних операцій запису. Він визначає кодові кандидати через активні lang-плагіни, поважає `.gitignore`, пропускає тести й службові дерева, а для згенерованої документації оцінює docgen-CRC з урахуванням повʼязаних usage-сценаріїв.

Публічні API-анкори: `isSourceFile`, `docPathForSource`, `isDocCandidate`, `scanForDocFiles`, `scanOrphanedDocs`, `describeFile`, `resolveRoot`.

Стан документації розрізняє відсутню доку як `stale:missing`, свіжу як `stale:false`, змінену відносно CRC як `crc-mismatch`, а ручні або чужі документи як `foreign:true` без позначення застарілості. Docgen-документи з CRC лишаються `foreign:false` і перевіряються за CRC-семантикою. Orphan-сканування окремо знаходить документацію, для якої зник source, але не вважає orphan ручні документи, Directory Index і docs у службових деревах.

## Поведінка

`resolveRoot` визначає корінь обходу з CLI або поточної теки. Від цього кореня весь сканер читає конфігурацію активних lang-плагінів, застосовує правила пропуску й повертає відносні шляхи результатів.

`scanForDocFiles` є основним потоком: обходить дерево від кореня, відсіює службові й ignored-дерева, root-level файли в system-wide docs layout, тести, `.d.ts` і некодові файли. Статус кандидата узгоджується через `isDocCandidate`, а кодове розширення — через `isSourceFile`. Розширення не вбудовані в ядро: JS/Vue, Python і Rust-файли стають джерелами лише тоді, коли їх декларують активні lang-плагіни; без такого плагіна файл не документується.

Для кожного кандидата `docPathForSource` спрямовує документацію в сусідню теку `docs/` зі stem імені джерела. Далі `describeFile` порівнює стан документа з джерелом і повертає, чи потрібне оновлення: відсутня документація дає `missing`, зміна джерела або повʼязаного usage-сценарію дає `crc-mismatch`, збіг CRC означає актуальний документ.

Рукописна документація має пріоритет над автоматичною генерацією. Якщо очікуваний doc-файл уже існує, але не має docgen-CRC у frontmatter, `describeFile` позначає його як foreign і не вважає stale. Це покриває як документи без frontmatter, так і документи з людським frontmatter без docgen-CRC; такі файли не мають мовчки перезаписуватись звичайним скануванням.

`scanForDocFiles` поважає `.gitignore`: ignored source-файли не потрапляють у результат, а шляхи без ignore-маркера залишаються кандидатами. Якщо git-контекст недоступний або ignored-шляхів немає, сканування продовжується без помилки.

`scanOrphanedDocs` працює окремим потоком очищення: шукає лише згенеровані doc-файли з resource і docgen-CRC та повідомляє ті, для яких source вже зник. Directory Index-документи з resource, що закінчується на `/`, ручні документи без CRC або без resource, а також документи всередині `node_modules` не вважаються orphan.

## Публічний API

- isSourceFile — Чи є файл кодовим джерелом для документування. Розширення декларують ЛИШЕ
активні lang-плагіни (`n-rules.contributes.docFiles.extensions` — js/mjs/ts/vue
дає `@7n/rules-lang-js`, .rs/.py — lang-rust/lang-python); у ядрі вбудованих
розширень немає (фаза 5b spec lang-plugins-extraction).
- docPathForSource — Обчислює шлях md-документа для кодового файлу: тека `docs/` поряд із джерелом.
Якщо `sourcePath` відносний, `docPath` теж відносний; якщо абсолютний — абсолютний.
- isDocCandidate — Чи кодовий файл `relPath` (posix, від кореня) підлягає документуванню:
правильне розширення, не тест, не в ignore-дереві, не кореневий system-wide docs.
- describeFile — Описує один кодовий файл: шлях джерела, шлях доки, стан застарілості за CRC.

`foreign: true` — docPath існує, але БЕЗ `docgen:`-CRC у frontmatter: рукописна
(людська) дока. Така дока вважається чинною документацією файлу (`stale: false`) —
генерація її мовчки не перезаписує (перезапис лише explicit `--overwrite`, який
бере всі цілі без фільтра). Живий кейс: `npm/docs/index.md` — людський зміст модуля
у проєкті-споживачі; сканер бачив його як `missing` і затирав чат-філером моделі.
- scanOrphanedDocs — Знаходить "сирітські" доки: `docs/<stem>.md` із `resource:` + `docgen.crc` у frontmatter,
у яких відповідний source-файл (resource:) вже не існує. Перевіряє лише файли,
згенеровані `fix-doc-files` (наявність `docgen.crc` у frontmatter). Directory Index
(resource із `/` на кінці) та ручні доки без `resource:` або без CRC — ігноруються.
- scanForDocFiles — Рекурсивно обходить дерево від `root`, повертає кодові файли зі станом застарілості.
Синхронний `readdirSync` — детермінований порядок без гонок; обсяг дерева це дозволяє.
Поверх `DOCGEN_IGNORE_GLOBS` відсіює ще й те, що в `.gitignore` (через git check-ignore).
- resolveRoot — Парсить `--root <dir>` з argv; default — cwd.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
