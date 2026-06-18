---
type: ADR
title: "Picomatch array-negation і JSDoc-коментар із glob-патерном"
---

# Picomatch array-negation і JSDoc-коментар із glob-патерном

**Status:** Accepted
**Date:** 2026-05-15

## Контекст

Під час реалізації `walkGlob` з виключеннями в `resolve-target-files.mjs` та написання JSDoc для `hc_pairing/check.mjs` виникли два несподіваних баги, що не були очевидними з документації.

## Рішення/Процедура/Факт

### Picomatch масив з негацією — OR-семантика, не AND-NOT

`picomatch(['pos', '!neg'])` трактує `'!neg'` **не** як виключення, а як окремий позитивний матчер «усе, що не є neg» (OR-семантика). Результат: будь-який рядок, що не є `**/kustomization.yaml`, проходить. Наприклад, `pm(['**/k8s/**', '!**/kustomization.yaml'])('a/b/c.md')` → `true`.

Правильний підхід: розбити масив на positives/negatives, застосувати `isMatch(positives)` і відфільтрувати через `isMatch(negatives)` окремо. Виправлено в `npm/scripts/utils/resolve-target-files.mjs`.

### JSDoc `**/` glob ламає bun-парсер

Послідовність `*/` у будь-якому місці блокового коментаря `/* … */` завершує коментар і ламає парсинг залишку файлу. У backtick-рядках усередині JSDoc `/** */` — теж. Bun суворіший за V8 щодо помилок парсингу. Обхід: замінити glob у JSDoc на словесний опис або уникати `**/` патернів у блокових коментарях.

## Обґрунтування

Документація picomatch не акцентує різницю між `pm(['pos', '!neg'])` і `pm('pos', {ignore: 'neg'})`: перша форма — OR між матчерами; друга — AND-not. Поведінка C-стилю коментарів щодо `*/` є стандартною, але несподіваною у JSDoc-контексті.

## Розглянуті альтернативи

- Передавати негацію через опцію `ignore` picomatch — функціонально еквівалентно, але ручний split positives/negatives прозоріший при читанні коду.

## Зачіпає

`npm/scripts/utils/resolve-target-files.mjs` (логіка `walkGlob`); `npm/rules/abie/js/hc_pairing/check.mjs` та будь-який `.mjs`, де JSDoc містить glob-патерни з `**/`
