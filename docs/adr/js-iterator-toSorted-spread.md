---
type: ADR
title: "JavaScript: `Map.keys()` і `new Set()` не мають `.toSorted()` — потрібен spread"
---

# JavaScript: `Map.keys()` і `new Set()` не мають `.toSorted()` — потрібен spread

**Status:** Accepted
**Date:** 2026-05-09

## Контекст

У `npm/scripts/check-k8s.mjs` під час конвертації image-replace patches у блок `images:` для kustomization.yaml двічі викликався `.toSorted()` безпосередньо на результаті `Map.keys()` та `new Set(opIndices)`. Це спричиняло runtime-помилку `…toSorted is not a function`, що блокувала конвертацію файлів у `run/{auth,nexus-b2b,old-net-backend}/k8s/ru/kustomization.yaml`.

## Рішення/Процедура/Факт

Виправлено два місця у `npm/scripts/check-k8s.mjs`:

- `byPatch.keys().toSorted(…)` → `[...byPatch.keys()].toSorted(…)`
- `new Set(opIndices).toSorted(…)` → `[...new Set(opIndices)].toSorted(…)`

Зміни увійшли до версії `1.8.214` із записом `### Fixed` у `npm/CHANGELOG.md`.

## Обґрунтування

`Map.keys()`, `Map.values()`, `Map.entries()` та конструктор `new Set()` повертають ітератори (`MapIterator`, `SetIterator`), а не масиви. Метод `.toSorted()` визначений лише на `Array.prototype`. Spread-оператор `[...iterator]` матеріалізує ітератор у масив і надає доступ до всіх Array-методів — мінімальна зміна без втрат продуктивності.

## Розглянуті альтернативи

`Array.from(iterator).toSorted(…)` — семантично ідентично, але `[...]` коротший і є усталеним патерном у кодовій базі.

## Зачіпає

`npm/scripts/check-k8s.mjs` — функції `applyConversionsToDoc` та `rewriteInlinePatchWithoutOps`; `npm/CHANGELOG.md`.
