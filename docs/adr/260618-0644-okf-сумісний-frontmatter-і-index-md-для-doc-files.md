---
session: 17ad250b-bad4-4ae0-9d0b-bcd95c950ae4
captured: 2026-06-18T06:44:54+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/17ad250b-bad4-4ae0-9d0b-bcd95c950ae4.jsonl
---

what does the previous conversation transcript document? Please generate the relevant ADRs.

---

## ADR OKF-сумісний frontmatter і index.md для doc-files

## Context and Problem Statement
Файлові доки, що генерує механізм `doc-files`, мали власний YAML-namespace `docgen:` без стандартних OKF-полів. Щоб зробити доки сумісними з Open Knowledge Format і придатними для AI-агентів та інструментів типу Marksman, їх потрібно розширити до OKF-мінімуму, а також генерувати `index.md` у кожній `docs/`-директорії.

## Considered Options
* Адитивно додати OKF-поля (`type`, `title`, `description`, `resource`, `tags`, `timestamp`) поруч із `docgen:` в тому самому frontmatter-блоці
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Адитивно додати OKF-поля в frontmatter", because Marksman ігнорує невідомі frontmatter-поля, `docgen:` CRC-механіка залишається недоторканою, а `resource`/`type`/`title` відповідають OKF-специфікації без заміни наявної структури.

### Consequences
* Good, because transcript фіксує очікувану користь: 240 файлів оновлено через `stamp`, директорійні `index.md` генеруються автоматично, Marksman-сумісність збережена.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли: `npm/rules/doc-files/js/docgen-crc.mjs`, `npm/rules/doc-files/js/docgen-files-batch.mjs`. Ключова функція: `buildDocFrontmatter`. Команда міграції: `node npm/rules/doc-files/js/docgen-files-batch.mjs stamp`.

---

## ADR Мінімальний набір OKF-полів (без resource, tags, timestamp)

## Context and Problem Statement
Після першого впровадження OKF-frontmatter постало питання, які поля є обов'язковими, а які надлишковими. `resource` дублює `docgen.source`, `tags` містили лише розширення файлу (вже видно з `type`/`title`), а `timestamp` змінювався при кожному `stamp` і спричиняв зайвий git-шум.

## Considered Options
* Залишити повний набір (`type`, `title`, `description`, `resource`, `tags`, `timestamp`, `docgen.*`)
* Скоротити до мінімуму: лише `type` (єдина вимога OKF) + `title` + `description`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Скоротити до мінімуму (`type`, `title`, `description`)", because `resource` дублює `docgen.source`, `tags` не додають інформації, а `timestamp` спричиняє зайвий git-шум без практичної користі.

### Consequences
* Good, because transcript фіксує очікувану користь: чистіший frontmatter, менше git-шуму від повторних stamp-прогонів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли: `npm/rules/doc-files/js/docgen-crc.mjs`. Видалені хелпери: `tagsForSource`, `extname`-використання лише в `typeForSource`.

---

## ADR Перенесення docgen.source на верхній рівень як resource

## Context and Problem Statement
Поле `source:` зберігалося у вкладеному namespace `docgen:`, тоді як OKF визначає `resource` як top-level поле. Після рішення про мінімальний OKF-набір `resource` було повернуто — вже не як дублікат, а як єдиний шлях джерела.

## Considered Options
* Залишити `source:` у `docgen:` і окремо додати `resource:` на верхньому рівні
* Перенести `source:` → `resource:` на верхній рівень, прибрати `source:` з `docgen:`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Перенести `source:` → `resource:` на верхній рівень, прибрати `source:` з `docgen:`", because `resource` — стандартне OKF-поле для шляху ресурсу; тримати паралельно два ідентичних поля надлишково.

### Consequences
* Good, because transcript фіксує очікувану користь: 240 файлів успішно оновлено, `parseDocFrontmatter` читає `resource:` без проблем.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені регекси: `RESOURCE_RE = /^resource:[ \t]+(.+)$/mu` в `docgen-crc.mjs`; `OKF_RESOURCE_RE` в `docgen-files-batch.mjs`. Зворотна сумісність зі старим `source:` (через `SOURCE_RE`/`LEGACY_SOURCE_RE`) була тимчасово додана, а потім явно видалена за запитом користувача.

---

## ADR Захист index.md від перезапису директорійним індексом

## Context and Problem Statement
Функція `generateDirIndex` генерує `index.md` у кожній `docs/`-директорії. Проте деякі `docs/index.md` вже є документацією для `index.ts`/`index.mjs` source-файлів — перший запуск stamp перезаписав 103 такі файли директорійним індексом.

## Considered Options
* Пропускати генерацію директорійного індексу, якщо `index.md` вже містить `type` що не є `Directory Index`
* Використовувати іншу назву для директорійних індексів (наприклад, `_index.md`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Пропускати генерацію якщо існуючий `index.md` не є `Directory Index`", because перевірка `existingType !== 'Directory Index'` через regex на frontmatter — найменша зміна, що захищає source-file-docs без введення нових конвенцій іменування.

### Consequences
* Good, because transcript фіксує очікувану користь: після виправлення і повторного stamp два легітимних `docs/index.md` (для `n-cursor-adr/index.ts` та `coverage-classify/index.mjs`) збережені з коректним типом `TS Module`/`JS Module`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінена функція: `generateDirIndex` у `npm/rules/doc-files/js/docgen-files-batch.mjs`. Умова захисту: `existingType !== 'Directory Index'` → skip. Проблема виявлена через: `grep -l "type: Directory Index"` на 124 `index.md` файлах.

---

## ADR Видалення H1-заголовка з тіла доки (title у frontmatter)

## Context and Problem Statement
Після перенесення `title` у OKF frontmatter тіло доки починалося з `# \`filename\`` — що дублює `title:` і є надлишковим у форматі де frontmatter вже визначає назву документа.

## Considered Options
* Прибрати H1 зі згенерованого тіла через strip у `stampDoc`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Прибрати H1 зі згенерованого тіла через strip у `stampDoc`", because `stampDoc` вже читає і переписує тіло — додавання `body.replace(/^# .+\n+/, '')` охоплює як нові генерації, так і всі 240 існуючих документів через один `stamp`-прогін.

### Consequences
* Good, because transcript фіксує очікувану користь: після stamp тіло одразу починається з `## Огляд`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінена функція: `stampDoc` у `npm/rules/doc-files/js/docgen-crc.mjs`. Regex: `/^# .+\n+/` застосовується до `cleanBody` перед `buildDocFrontmatter`.

---

## ADR Видалення поля description із frontmatter

## Context and Problem Statement
Поле `description` в OKF frontmatter генерувалося через `extractDescription` (перше речення з секції `## Огляд`). Після обговорення користувач вирішив прибрати його — опис вже є у тілі доки, а дублювати у frontmatter надлишково.

## Considered Options
* Залишити `description` у frontmatter
* Видалити `description` із frontmatter, `extractDescription` і параметр `body`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Видалити `description` із frontmatter", because опис присутній у тілі доки і frontmatter-дублювання не додає цінності.

### Consequences
* Good, because transcript фіксує очікувану користь: спрощений frontmatter, видалено `extractDescription`, `OKF_DESC_RE` і параметр `body` з `buildDocFrontmatter`; колонка Опис прибрана з `index.md`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Фінальний OKF-мінімум: `type`, `title`, `resource` + `docgen: { crc, [score], [model] }`. Змінені функції: `buildDocFrontmatter`, `stampDoc`, `generateDirIndex` в `docgen-crc.mjs` та `docgen-files-batch.mjs`. Команда перевірки: `node npm/rules/doc-files/js/docgen-files-batch.mjs stamp`.
