# LLM-нормалізація чернеток ADR без авто-коміту

**Status:** Accepted
**Date:** 2026-05-15

## Контекст

Правило `adr` накопичувало чернетки без будь-якого механізму їх структурування — після кількох тижнів роботи накопичилося 156 файлів, які ніхто не переглядав. Виникла потреба у автоматизованій нормалізації без ручного втручання після кожної сесії.

## Рішення/Процедура/Факт

- Ознака «чернетка» — наявність `session:` у YAML-frontmatter; чернетки пишуться безпосередньо у `docs/adr/<timestamp>-<sid>.md`. Канонічні файли мають назву `<slug-українською>.md` без frontmatter.
- Новий Stop-hook `normalize-decisions.sh` запускається асинхронно (`timeout: 600`), коли кількість draft-файлів досягає `ADR_NORMALIZE_THRESHOLD` (default 30). LLM повертає JSON-масив операцій `{op: "rewrite"|"delete"|"merge-into", file, slug?, content?, target?, additions?}`, скрипт застосовує їх до working tree.
- Жодного `git add` або `git commit` — розробник бачить зміни через `git status` і `git diff` та сам вирішує, що прийняти.
- Нова skill `adr-normalize` для ручного тригера поза порогом.
- Версія `@nitra/cursor` 1.9.23 → 1.10.0; оновлено `sync-claude-config.mjs`, `check.mjs`, `settings_json.rego`, `settings_local_json.rego`, `auto-skills.mjs`, `.gitignore`.

## Обґрунтування

Підхід «маркер у frontmatter замість окремої теки» дозволяє LLM редагувати або видаляти той самий файл на місці без переміщення між директоріями — менше рухомих частин. Відсутність авто-коміту критично важлива: LLM може кластеризувати теми неточно, тому `git diff` перед комітом — єдине review-вікно. Дата у фінальному ADR береться з `captured` (час події), а не з часу нормалізації, щоб ADR датувався реальним рішенням.

## Розглянуті альтернативи

- Batch-команда `npx @nitra/cursor adr-promote` (ручний запуск) — відхилено як менш автоматизована.
- Continuous-промоція на кожен Stop — відхилено: рішення ще змінюються протягом сесії.
- Запис нормалізованих файлів у `docs/adr/_pending/` — відхилено: зайве тертя.
- Однофазний LLM-виклик на весь батч — залишено як основний.

## Зачіпає

`npm/.claude-template/hooks/capture-decisions.sh`, `npm/.claude-template/hooks/normalize-decisions.sh` (новий), `npm/scripts/sync-claude-config.mjs`, `npm/rules/adr/js/check.mjs`, `npm/rules/adr/adr.mdc`, `npm/rules/adr/policy/settings_json/settings_json.rego`, `npm/rules/adr/policy/settings_local_json/settings_local_json.rego`, `npm/scripts/auto-skills.mjs`, `npm/skills/adr-normalize/SKILL.md` (новий), `.gitignore`, `npm/package.json`, `npm/CHANGELOG.md`
