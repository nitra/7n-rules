# overlay-paths.mjs

## Огляд

Набір чистих path-хелперів для overlay-перевірок правила abie: класифікація шляхів (ua-overlay проти base-шару), виведення каталогу пакета з overlay-шляху, умовні питання правила (чи потрібен HTTPRoute, чи є Deployment). Уся логіка — над рядками/шляхами та перевіркою існування файлів; YAML не парситься.

## Поведінка

- ua-overlay: шлях закінчується на `ua/kustomization.yaml`; base-шар — за сегментом `base/`.
- Каталог пакета: з `…/k8s/ua/kustomization.yaml` виділяється батько `k8s/`; без збігу — немає результату.
- HTTPRoute-gate: вимога лише для Vite-пакетів (є `vite.config.{js,mjs,ts}`).
- Deployment: чи хоч один каталог із Deployment лежить у `k8s/` цього пакета.
- base-шар: yaml під `<пакет>/k8s/` і не в `ua/`.
- Шляхи нормалізуються до posix (`\`→`/`).

## Публічний API

- `isUaKustomizationPath`, `abiePackageDirFromK8sOverlay`, `abieOverlayRequiresHttpRouteByVite`, `abieOverlayK8sTreeHasDeployment`, `isAbieK8sBaseYamlPath`, `isK8sYamlInAbiePackageExcludingUaOverlay`.

## Гарантії поведінки

- Read-only, без побічних ефектів.
- Невідповідність шаблону → негативний/порожній результат, не виняток.
- Незалежність від ОС (розділювачі зводяться до `/`).
