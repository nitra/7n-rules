# Обов'язковий блок concurrency у всіх GitHub Actions workflow

**Status:** Accepted
**Date:** 2026-05-06

## Контекст

Репозиторій містив кілька `.github/workflows/*.yml`-файлів без секції `concurrency`, через що при паралельних запусках (push + PR тощо) кілька екземплярів одного workflow могли виконуватись одночасно, витрачаючи CI-квоту та потенційно створюючи race conditions.

## Рішення/Процедура/Факт

Введено обов'язкову вимогу: кожен workflow у `.github/workflows/` має містити:

```yaml
concurrency:
  group: ${{ github.ref }}-${{ github.workflow }}
  cancel-in-progress: true
```

Зміни охопили:
1. Блок dodano до трьох workflow (`clean-ga-workflows.yml`, `clean-merged-branch.yml`, `git-ai.yml`).
2. `npm/mdc/ga.mdc` оновлено v1.6 → v1.7 із вимогою та канонічними прикладами.
3. Нові функції `validateConcurrencyOnRoot` / `verifyConcurrencyBlock` у `npm/scripts/check-ga.mjs` — перевіряє `group === '${{ github.ref }}-${{ github.workflow }}'` і `cancel-in-progress === true` для кожного `*.yml`.
4. Версія: 1.8.182 → 1.8.183.

## Обґрунтування

Рішення прийнято як явна командна норма. Для deploy/release-workflow `cancel-in-progress: true` технічно ризикований (обрив посеред publish може лишити артефакт у проміжному стані), однак користувач свідомо прийняв однорідне правило без винятків, надаючи перевагу простоті та єдності стандарту.

## Розглянуті альтернативи

Диференційований підхід — `cancel-in-progress: true` лише для PR/CI-workflow, `false` для deploy/publish/schedule. Явно обговорювався, але відхилений на користь єдиного правила.

## Зачіпає

`.github/workflows/clean-ga-workflows.yml`, `.github/workflows/clean-merged-branch.yml`, `.github/workflows/git-ai.yml`; `npm/mdc/ga.mdc`; `npm/scripts/check-ga.mjs`; `npm/package.json`, `npm/CHANGELOG.md`.
