# GitHub Package Releases — Design

## Мета

Після успішної публікації кожної npm-версії автоматично створювати окремий GitHub Release для її package-тегу. Release має містити людський опис змін саме цього пакета.

## Межі

- Один Release на один наявний package-тег, наприклад `@7n/rules@1.54.0`.
- Один універсальний workflow обробляє всі package-теги; окремі workflow для workspaces не створюються.
- Вміст Release береться з секції тієї ж версії у `CHANGELOG.md` workspace-пакета.
- npm publish лишається незалежним: збій створення Release не відкочує вже опублікований пакет.
- Першим релізом буде тег `@7n/rules`, створений release-процесом після merge PR #266; його опис походить із нової секції `npm/CHANGELOG.md`, згенерованої з change-файлу PR.

## Архітектура

Новий GitHub Actions workflow запускається подією `push` для тегів, які містять package name і semver. Він виконується після того, як `npm-publish` успішно опублікував пакет і відправив release-коміт разом із тегами.

Workflow:

1. Checkout робить повну історію на tag commit.
2. Скрипт розбирає тег на package name та version, зіставляє package name з workspace `package.json` і визначає шлях до його `CHANGELOG.md`.
3. Скрипт витягує Markdown між заголовком `## [<version>]` і наступним заголовком того ж рівня.
4. `gh release create` створює Release з tag name, заголовком `<package>@<version>` та витягнутим описом.

Якщо Release вже існує, workflow завершується успішно без зміни його вмісту. Це робить повторні доставки tag push безпечними й не переписує вручну відредаговані release notes.

## Дані та помилки

- Непідтримуваний tag або workspace без `CHANGELOG.md` завершує job з чіткою помилкою: release не можна створити без перевіреного опису.
- Відсутня секція версії в changelog також є помилкою, бо означає розрив між тегом і release notes.
- Job має тільки `contents: write`; секрети не потрібні, використовується стандартний `GITHUB_TOKEN`.
- Для `@scope/package@version` розбір виконується від останнього `@`, тому scope не плутається з версією.

## Перевірки

- Unit-тести перевіряють розбір scoped і unscoped тегів, пошук workspace, витяг changelog-секції та ідемпотентну поведінку.
- Workflow перевіряється на синтаксис й існуючими CI правилами.
- В end-to-end сценарії після merge PR #266 release engine створює новий тег `@7n/rules` з обчисленою версією, а tag workflow створює відповідний GitHub Release з описом із `npm/CHANGELOG.md`.

## Відхилені варіанти

- Створювати Release в `npm-publish`: npm уже буде опубліковано до GitHub API помилки, але весь publish job стане failed; окремий workflow ізолює цей ризик.
- Один release на release-коміт: він змішує зміни кількох packages і не дає однозначного зв’язку з npm-версією.
