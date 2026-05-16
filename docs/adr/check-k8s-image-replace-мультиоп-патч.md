# Автоконверт `image-replace` з мультиоп-патчів у `images:` (check-k8s)

**Status:** Accepted
**Date:** 2026-05-07

## Контекст

Автофіксер у `scripts/check-k8s.mjs` перетворював JSON6902-патч `op: replace` на `/spec/template/spec/containers/<N>/image` на запис `images:` тільки якщо `patch:` містив рівно одну операцію. Реальні kustomization-файли (наприклад `hasura/k8s/ru/kustomization.yaml`) мають патчі з кількома операціями одночасно — image-replace разом із `add nodeSelector`, `replace resources` тощо — і автоконверт мовчки їх пропускав.

## Рішення/Процедура/Факт

1. `tryParseSingleJson6902Array` (відкидала масиви `length !== 1`) замінено на `tryParseJson6902Array` — приймає масив будь-якої довжини ≥ 1.
2. `imageReplaceDeploymentPatchInfo` тепер повертає `{ deployName, totalOps, ops: Array<{ containerIndex, newImage, opIndex }> }`.
3. `parseKustomizationWithPatches` видає окремий кандидат на кожну image-replace op у патчі (вкладений цикл по `info.ops`).
4. `buildConversionForCandidate` пробрасовує `opIndex` і `totalOps` у результат конвертації.
5. `applyConversionsToDoc` групує конвертації за `index` патча: якщо всі ops конвертовано (`opIdx.length === totalOps`) — видаляє `patches[i]` повністю; інакше — переписує `patch:` через `rewriteInlinePatchWithoutOps`, яка видаляє лише конвертовані ops зі збереженням block-literal (`|-`) стилю та вихідного порядку решти ops.
6. Нова функція `rewriteInlinePatchWithoutOps`: парсить `patch:` текст, видаляє ops за індексами з кінця, серіалізує назад у YAML з `flow = false`.
7. `npm/mdc/k8s.mdc`: версія `1.26` → `1.27`, уточнено опис поведінки авто-перевірки в пункті «Зміна image».
8. `tests/check-k8s-images.test.mjs`: оновлено unit-тест під нову сигнатуру; додано 5 e2e-кейсів (solo-replace, mixed image+nodeSelector, hasura-style 4-op patch, multi-image, mixed з digest).
9. `package.json` `1.8.202 → 1.8.203`, запис у `CHANGELOG.md`.

## Обґрунтування

Реальні overlay-файли рідко мають патчі лише з однією операцією — разом із image-replace часто є `nodeSelector`, `resources`, `env`-патчі. Обмеження `length === 1` робило автофіксер нездійсненним для переважної більшості практичних випадків. Підхід «видалити лише конвертовані ops, залишити решту» відповідає принципу найменшого здивування і не порушує логіку сортування ops (її контролює окрема перевірка `kustomizationInlinePatchOpsSortedViolation`).

## Розглянуті альтернативи

Підхід «скопіювати весь `patches[i]` у окремий новий патч тільки для image-replace» не розглядався; обраний підхід in-place хірургічного видалення ops простіший і не дублює target-блок.

## Зачіпає

- `npm/scripts/check-k8s.mjs` — функції `tryParseJson6902Array`, `imageReplaceDeploymentPatchInfo`, `parseKustomizationWithPatches`, `buildConversionForCandidate`, `applyConversionsToDoc`, нова `rewriteInlinePatchWithoutOps`
- `npm/mdc/k8s.mdc` — версія `1.27`
- `npm/tests/check-k8s-images.test.mjs`
- `npm/package.json`, `npm/CHANGELOG.md` — версія `1.8.203`
