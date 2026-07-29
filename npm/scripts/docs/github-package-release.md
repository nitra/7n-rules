---
type: JS Module
title: github-package-release.mjs
resource: npm/scripts/github-package-release.mjs
docgen:
  crc: 8bcec2bb
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Підготовка metadata й notes для GitHub Release package-тегу.

## Поведінка

parsePackageTag розбирає Git tag у назву пакета та версію, викидаючи помилку, якщо тег не містить розділювача `@` або якщо розділювач знаходиться на початку/кінці.

extractChangelogSection видобуває повний Markdown блок опису для вказаної версії з файлу CHANGELOG.md, викидаючи помилку, якщо відповідна секція відсутня.

findPublishablePackage шукає в дереві робочого простору єдиний пакет, чий `package.json` збігається з наданою назвою, і повертає його директорію та версію, викидаючи помилку, якщо не знайдено єдиного такого пакета.

prepareGitHubRelease готує метадані для створення релізу, вимагаючи кореневий шлях репозиторію та Git tag, і перевіряє узгодженість версії з метаданими пакета.

releaseTagsForWorkspaces отримує список шляхів workspace-ів та перетворює їх на відповідні package-теги на основі версій, зазначених у їхніх `package.json`, викидаючи помилку, якщо workspace не є публікувальним.

run виконує основну логіку: або виводить список пар `name@version` для наданих тегів у режимі `--tags`, або збирає метадані релізу для одного тегу та записує отримані ноти до вказаного шляху.

Подібно до `findPublishablePackage`, код свідомо ігнорує каталоги `.git` та `node_modules` під час пошуку пакетів.

## Публічний API

- parsePackageTag — Розділяє package-тег `<name>@<version>`, не плутаючи scope з роздільником версії.
- extractChangelogSection — Витягує одну Keep a Changelog секцію з Markdown за її версією.
- findPublishablePackage — Знаходить publishable npm package за name в усьому дереві workspace.
- prepareGitHubRelease — Готує назву й changelog notes GitHub Release для конкретного package-тегу.
- releaseTagsForWorkspaces — Перетворює release-workspaces на package-теги за поточними manifests.
- run — Записує release notes у переданий шлях для GitHub Actions workflow.

## Сценарії використання

- `npm/scripts/tests/github-package-release.test.mjs` (parsePackageTag; extractChangelogSection) — розділяє scoped package і semver за останнім @; розділяє unscoped package і semver; повертає тільки секцію запитаної версії; знаходить scoped package без hardcoded workspace-шляху; формує title і notes з changelog package-версії; ще 3

## Гарантії поведінки

- Свідомо пропускає шляхи: `.git`, `node_modules`.
