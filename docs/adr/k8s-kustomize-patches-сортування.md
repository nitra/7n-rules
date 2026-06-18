---
type: ADR
title: "Структурне сортування `patches` у Kustomize-перевірці"
---

# Структурне сортування `patches` у Kustomize-перевірці

**Status:** Accepted
**Date:** 2026-05-07

## Контекст

У `check-k8s.mjs` вже була перевірка алфавітного сортування ресурсів `kustomization.yaml`, але секція `patches` не мала жодних вимог до порядку, що спричиняло неконсистентні diff'и між середовищами.

## Рішення/Процедура/Факт

До `check-k8s.mjs` додано дві нові структурні перевірки:

1. Масив `patches` повинен бути відсортований — спочатку за `target.kind` (без урахування регістру і локалі, за зростанням), потім у межах однакового `kind` — за `target.name`.
2. Рядковий блок `patch: |-` (масив JSON-Patch операцій) повинен бути відсортований за полем `path` (за зростанням).

## Обґрунтування

Детермінований порядок рядків у `kustomization.yaml` зменшує шум у git diff, спрощує code review та унеможливлює дублікати, які важко помітити в несортованому списку. Сортування `kind → name` відповідає загальній конвенції Kubernetes (ресурси групуються за типом), а сортування patch-операцій за `path` відповідає природному порядку читання маніфесту.

## Розглянуті альтернативи

Альтернативи не обговорювались — підхід `kind → name` для `patches` і `path` для patch-операцій задано безпосередньо у вимогах.

## Зачіпає

`npm/scripts/check-k8s.mjs` (нові violation-функції поруч з `kustomizationResourcesSortedAlphabeticallyViolation`), `npm/mdc/k8s.mdc`.

## Update 2026-05-07

Реалізовано дві pure-функції в `npm/scripts/check-k8s.mjs`:

- `kustomizationPatchesSortedViolation` — перевіряє, що `patches[]` відсортований за tuple `[target.kind, target.name, target.namespace]` (en, case-insensitive `localeCompare`).
- `kustomizationInlinePatchOpsSortedViolation` — перевіряє, що ops у `patch: |-` відсортовані за `path`, але лише якщо: (1) всі ops ∈ `{add, replace}`, (2) всі `path` є disjoint (жоден не є префіксом іншого); інакше повертає `null` без порушення.

Обидві функції підключені у `validateKustomizationPatchesSorted` і далі в `check()`. `npm/mdc/k8s.mdc` доповнено описом нових вимог. Версія `1.8.199 → 1.8.200`, `CHANGELOG.md` оновлено. Усі 169 тестів проходять.

**Файли:** `npm/scripts/check-k8s.mjs`, `npm/mdc/k8s.mdc`, `npm/tests/check-k8s-schema.test.mjs`, `npm/package.json`, `npm/CHANGELOG.md`.
