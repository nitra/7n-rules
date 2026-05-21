# Kubescape через `kustomize build` + stdin замість прямого сканування каталогу

**Status:** Accepted
**Date:** 2026-05-19

## Context and Problem Statement

У пакеті `@nitra/cursor` (`rules/k8s/lint/lint.mjs`) `kubescape scan <dir>` передавав сирий каталог без виконання `kustomize build`. NetworkPolicy з `k8s/components/networkpolicy.yaml` (без `metadata.namespace`) бачилася в ізоляції — namespace не інжектувався kustomize-оверлеєм, `podSelector`-match не відбувався, і control C-0260 (`Missing network policy`) спрацьовував хибнопозитивно.

## Considered Options

* Запускати `kustomize build <dir>` і передавати зібраний маніфест у `kubescape scan -` через stdin для кожного buildable Kustomization.
* Залишити прямий `kubescape scan <dir>` (поточна поведінка).

## Decision Outcome

Chosen option: "Запускати `kustomize build <dir>` і передавати результат у `kubescape scan -` через stdin", because kubescape не виконує `kustomize build` самостійно, тому попередня збірка маніфесту усуває хибнопозитивне C-0260 для ресурсів у `components/` без `metadata.namespace`.

### Consequences

* Good, because NetworkPolicy у `k8s/components/` більше не викликає помилкових C-0260 — namespace коректно інжектується kustomize-оверлеєм до сканування.
* Bad, because `kustomize` стає обов'язковою залежністю PATH поруч із `kubeconform` і `kubescape`; consumer-репозиторії мусять додати крок `Install kustomize` до CI (GHA-приклад додано в `k8s.mdc`).

## More Information

- Змінено: `npm/rules/k8s/lint/lint.mjs` — додано `findKustomizationDirs` (розрізняє `kind: Kustomization` і `kind: Component`), `runKubescape` переписано на async; стара поведінка (`scan <dir>`) залишена як fallback для дерев без `kustomization.yaml`.
- Тести: `npm/rules/k8s/lint/run-roots.test.mjs` — 2 нових тести для `findKustomizationDirs`; всі 8 тестів проходять.
- Документація: `npm/rules/k8s/k8s.mdc` версія `1.36` → `1.37`; задокументовано нову залежність `kustomize`, пайплайн `kustomize build | kubescape scan -`, мотивацію C-0260, GHA-крок встановлення.
- Версія пакета: `npm/package.json` `1.13.48` → `1.13.49`; запис у `npm/CHANGELOG.md`.

## Update 2026-05-19

### Заміна окремого бінарника `kustomize` на `kubectl kustomize`

Функцію `runKustomizeBuild` оновлено: замість окремого бінарника `kustomize build <dir>` використовується вбудована підкоманда `kubectl kustomize <dir>`. kubectl 1.36+ містить Kustomize v5.8.1 і є обов'язковою залежністю середовища — окремий бінарник `kustomize` є надлишковою залежністю.

- Прибрано крок `Install kustomize` (curl-скрипт kubernetes-sigs) з CI-сніпета в `k8s.mdc`.
- Залежності PATH після зміни: `kubeconform`, `kubescape`, `kubectl` (kustomize через `kubectl kustomize`).
- Версія k8s.mdc: `1.37` → `1.38`; версія пакета: `1.13.49` → `1.13.50`.
- Тести: `bun test npm/rules/k8s/lint/` — 8 pass, 0 fail.
- Підтверджено: `kubectl version --client` → `Client Version: v1.36.1`, `Kustomize Version: v5.8.1`.
