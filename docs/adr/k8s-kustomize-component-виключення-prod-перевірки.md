---
type: ADR
title: "k8s: Виключення Kustomize Component із prod-overlay-перевірки HPA/PDB"
---

# k8s: Виключення Kustomize Component із prod-overlay-перевірки HPA/PDB

**Status:** Accepted
**Date:** 2026-05-09

## Контекст

У `@nitra/cursor@1.8.219` введено канон HPA+PDB через `<pkg>/k8s/components/` (Kustomize Component, `kind: Component`). Функція `prodOverlayHpaPdbOverrideNeeds` у `scripts/check-k8s.mjs` трактувала будь-який `kustomization.yaml` поза `base/`/`dev/`/`*-qa/` як прод-overlay і вимагала JSON6902-патчів для `spec.minReplicas`, `spec.maxReplicas`, `spec.minAvailable`. Через це `components/kustomization.yaml` (джерело ресурсів, не overlay) хибно тригерив 45 помилок (15 пакетів × 3 поля).

## Рішення/Процедура/Факт

У `scripts/check-k8s.mjs` в функції `prodOverlayHpaPdbOverrideNeeds` додано ранній `return { needsHpaReplicaPatches: false, needsPdbMinAvailablePatch: false }`, якщо перший YAML-документ `kustomization.yaml` містить `kind: Component`. JSDoc функції оновлено з явним описом цього винятку.

У `mdc/k8s.mdc` до розділу `components/` додано абзац: `components/kustomization.yaml` з `kind: Component` є джерелом ресурсів для overlays, а не overlay сам по собі — `check k8s` не вимагає від нього прод-патчів.

У `tests/check-k8s-schema.test.mjs` додано новий тест: `components/kustomization.yaml` з `kind: Component` → `{ needsHpaReplicaPatches: false, needsPdbMinAvailablePatch: false }`. Регресійний кейс для звичайного прод-overlay залишився незмінним.

Версія: `1.8.219 → 1.8.220`; запис у `CHANGELOG.md` у секції `### Fixed`. Другий розділ цього файлу (канонічна структура HPA/PDB) повністю покритий ADR `k8s-hpa-pdb-kustomize-component.md`.

## Обґрунтування

Kustomize Component (`kind: Component`) — env-нейтральне джерело ресурсів HPA/PDB: overlays підключають його через `components:` і перевизначають через JSON6902-патчі. Вимагати від самого Component прод-патчів логічно неправильно — він не знає контексту оточення. Перевірка наявності `kind: Component` через `readFirstYamlObject` є мінімальним і прямолінійним критерієм розмежування.

## Розглянуті альтернативи

Не розглядалися; технічне завдання однозначно вказало конкретну реалізацію — ранній `return` на основі `kind: Component`.

## Зачіпає

`npm/scripts/check-k8s.mjs` (функція `prodOverlayHpaPdbOverrideNeeds`), `npm/mdc/k8s.mdc` (документація розділу `components/`), `npm/tests/check-k8s-schema.test.mjs`, `npm/package.json`, `npm/CHANGELOG.md`.
