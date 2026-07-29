---
type: JS Module
title: github-package-release.mjs
resource: npm/scripts/github-package-release.mjs
docgen:
  crc: cf2d07e7
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Підготовка metadata й notes для GitHub Release package-тегу.

## Поведінка

parsePackageTag повертає назву та версію пакета, якщо введений Git tag коректно розділений `@`. У разі некоректного формату тегу викликається помилка.

extractChangelogSection витягує повний текстовий блок опису версії з файлу CHANGELOG.md, якщо такий блок існує відповідно до вказаної версії. Якщо секція з версією не знайдена, викликається помилка.

findPublishablePackage ідентифікує один вихідний npm-пакет у дереві workspace, що відповідає заданій назві, і повертає його директорію та версію. Якщо знайдено більше одного або жодного такого пакета, викликається помилка.

prepareGitHubRelease готує метадані для GitHub Release, збігаючись назви та версії пакета, знайденого у `package.json`, з тим, що вказано у Git tag. У разі невідповідності версій генерується помилка.

releaseTagsForWorkspaces трансформує надані шляхи workspace-ів у формат package-тегу, використовуючи дані з їхніх `package.json`. Якщо якийсь workspace не є публікувальним або його шлях некоректний, викликається помилка.

run виконує основну логіку: або виводить список пакетів у формат package-тегу, якщо вказаний флаг `--tags`, або готує файл із notes для GitHub Release за вказаним тегом і шляхом.

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
