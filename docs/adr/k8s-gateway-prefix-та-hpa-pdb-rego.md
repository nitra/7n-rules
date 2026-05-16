# Виправлення `GATEWAY_API_GROUP_PREFIX` та Rego defense-in-depth для HPA/PDB у `k8s/base`

**Status:** Accepted
**Date:** 2026-05-11

## Контекст

Правило «HPA і PDB у `k8s/base` заборонені» було реалізоване у `check-k8s.mjs` функцією `validateKustomizeHpaPdbOnlyWithBaseDeployment`, але ніколи не спрацьовувало. Причина: функція `validateHasuraHttpRouteCanon`, що стоїть раніше у черзі виконання, зверталася до незадекларованої константи `GATEWAY_API_GROUP_PREFIX` і кидала `ReferenceError`. Зовнішній `try/catch` у `bin/n-cursor.js` поглинав виняток як «Помилка виконання», і всі наступні JS-валідатори мовчки пропускалися.

## Рішення/Процедура/Факт

1. У `npm/scripts/check-k8s.mjs` оголошено константу `const GATEWAY_API_GROUP_PREFIX = 'gateway.networking.k8s.io/'` — усуває `ReferenceError` і розблоковує весь ланцюжок cross-file JS-валідаторів.
2. У `npm/policy/k8s/base_kustomization/base_kustomization.rego` додано deny-правило `base_hpa_pdb_forbidden`: якщо файл розпізнається як `k8s/base/kustomization.yaml` і його `resources:` містить шлях із суфіксом `/hpa.yaml`, `/pdb.yaml`, `/hpa.yml` або `/pdb.yml` — deny. Rego-правило виконується батчем `runAllK8sRego` до будь-якого JS-кроку.
3. До `npm/policy/k8s/base_kustomization/base_kustomization_test.rego` додано 5 нових тест-кейсів: `hpa.yaml`/`pdb.yaml`/`hpa.yml` у `resources:` ловляться; чистий `resources:` і lookalike-назви (`myhpa.yaml`, `pdb-extra.yaml`) проходять. Усі 10 rego-тестів і 206 bun k8s-тестів зелені.
4. Версію пакету піднято до `1.9.1`; `npm/CHANGELOG.md` оновлено секціями `### Fixed` та `### Added`.

## Обґрунтування

Rego-deny є single-document gate і запускається до JS-кроку, тому залишається ефективним навіть якщо JS-частина знову зламається. JS-правило (`validateKustomizeHpaPdbOnlyWithBaseDeployment`) потрібне для рекурсивного обходу `bases:`/`components:` — filesystem-доступ у Rego неможливий. Комбінація двох рівнів покриває як локальний прямий випадок (Rego), так і транзитивні посилання через дерево компонентів (JS).

## Розглянуті альтернативи

- Переписати всю перевірку у Rego — неможливо без filesystem-доступу для рекурсивного обходу дерева `bases:`/`components:`.
- Залишити лише JS-фікс без Rego-шару — менш надійно, якщо в майбутньому з'явиться новий `ReferenceError` у тій самій черзі виконання.
- Обгорнути кожен JS-валідатор в окремий `try/catch` — правильний захід, але не є першопричиною й не додає декларативного покриття.

## Зачіпає

`npm/scripts/check-k8s.mjs`, `npm/policy/k8s/base_kustomization/base_kustomization.rego`, `npm/policy/k8s/base_kustomization/base_kustomization_test.rego`, `npm/package.json`, `npm/CHANGELOG.md`
