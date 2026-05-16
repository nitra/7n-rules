# k8s: HPA і PDB через Kustomize Component (`components/`)

**Status:** Accepted
**Date:** 2026-05-09

## Контекст

`base/` (dev) не потребує автомасштабування. До версії `1.8.219` HPA і PDB зберігалися у `base/hpa.yaml` і `base/pdb.yaml`, що захаращувало dev-конфіг і вимагало `$patch: delete` в overlay-ях для видалення — крихкий шаблон, що ускладнює розуміння kustomization-дерева.

## Рішення/Процедура/Факт

Введено канонічну структуру: один Kustomize Component (фіксована директорія `components/`, sibling до `base/`) на сервіс містить `kustomization.yaml` (`apiVersion: kustomize.config.k8s.io/v1alpha1`, `kind: Component`), `hpa.yaml` і `pdb.yaml` з dev-like значеннями. `base/kustomization.yaml` **не** підключає `components/`. Прод-overlays (`ua/`, `ru/`) підключають `components: [- ../components]` і накладають JSON6902-патчі для реальних `minReplicas`/`maxReplicas`/`minAvailable`.

Локальні `base/hpa.yaml` і `base/pdb.yaml` заборонені на рівні file-existence check у `check-k8s.mjs`.

Змінені файли: `npm/mdc/k8s.mdc` (переписано розділ HPA/PDB), `npm/scripts/check-k8s.mjs` (додано `validateComponentsForBaseDeployment`, `verifyK8sBaseKustomizeHasNoHpaPdb`, константу `COMPONENTS_DIR='components'`; видалено мертві функції `patchTextDeclaresHpaStrategicDelete`, `kustomizationDeclaresHpaStrategicDelete`, `verifyK8sBaseKustomizeHpaDeletedWhenInherited`), `npm/tests/check-k8s-schema.test.mjs` (замінено тести старої моделі, додано `describe('validateComponentsForBaseDeployment')`) — реліз `1.8.219`.

## Обґрунтування

Kustomize Component дозволяє overlay-ям вибірково підключати HPA/PDB лише там, де це потрібно (прод), без примусового `$patch: delete` у кожному dev-overlay. `base/` залишається чистим: якщо ресурс не включено — він відсутній, а не прихований патчем. Фіксована назва `components/` (замість `scale/`, `hpa-component/`) зменшує варіативність і спрощує документацію та повідомлення про помилки.

## Розглянуті альтернативи

- `$patch: delete` HPA/PDB у base через стратегічний merge — відкинуто як крихке рішення.
- Альтернативні назви каталогу (`scale/`, `hpa-component/`, `pdb-component/`) — відкинуто на користь єдиного `components/`.

## Зачіпає

`npm/mdc/k8s.mdc`, `npm/scripts/check-k8s.mjs` (публічний API: `validateComponentsForBaseDeployment`, `COMPONENTS_DIR`; видалено: `patchTextDeclaresHpaStrategicDelete`, `kustomizationDeclaresHpaStrategicDelete`), `npm/tests/check-k8s-schema.test.mjs`, `npm/package.json`, `npm/CHANGELOG.md`; усі репозиторії, що використовують `@nitra/cursor` правило `k8s` і мають `<pkg>/k8s/base/hpa.yaml` або `base/pdb.yaml`.
