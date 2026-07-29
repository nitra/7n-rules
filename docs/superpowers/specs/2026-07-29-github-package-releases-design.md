# GitHub Package Releases — Design

## Мета

Після успішної публікації кожної npm-версії автоматично створювати окремий GitHub Release для її package-тегу. Release має містити людський опис змін саме цього пакета.

## Межі

- Один Release на один наявний package-тег, наприклад `@7n/rules@1.54.0`.
- Один універсальний workflow обробляє теги **всіх publishable npm workspaces** монорепо: core packages, CI- та language-плагіни, а також platform packages, якщо release engine створює для них тег.
- Workflow не містить списку пакетів: за package name із тегу він знаходить відповідний `package.json` у workspace tree й читає `CHANGELOG.md` поряд із ним.
- Вміст Release береться з секції тієї ж версії у `CHANGELOG.md` знайденого пакета.
- npm publish лишається незалежним: збій створення Release не відкочує вже опублікований пакет.
- Першим релізом буде тег `@7n/rules`, створений release-процесом після merge PR #266; його опис походить із нової секції `npm/CHANGELOG.md`, згенерованої з change-файлу PR.

## Архітектура

`npm-publish` створює GitHub Releases власним завершальним кроком після того, як успішно опублікував пакети й відправив release-коміт разом із тегами. Окремий tag-triggered workflow може лишатися лише як fallback для тегів, які пушить людина: GitHub не запускає workflow від tag push, виконаного через `GITHUB_TOKEN` іншого workflow.

Workflow:

1. Release engine повертає список workspaces з новою версією, а publish-кроки фіксують фактичні успішні package name/version.
2. Після `git push --follow-tags` завершальний крок бере лише успішно опубліковані package-теги.
3. Скрипт розбирає тег на package name та version, обходить усі `package.json` publishable workspaces, зіставляє package name й визначає шлях до його `CHANGELOG.md`.
4. Скрипт витягує Markdown між заголовком `## [<version>]` і наступним заголовком того ж рівня, а `gh release create` створює Release з цим описом.

Якщо Release вже існує, крок завершується успішно без зміни його вмісту. Помилка цього кроку не відкочує вже опублікований npm-пакет: `continue-on-error` зберігає незалежність npm publish, а CI лог лишається сигналом для ручного повтору.

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
