---
session: 700aa5f1-fa41-40b2-900e-eb9e3e66f690
captured: 2026-05-19T10:26:21+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/700aa5f1-fa41-40b2-900e-eb9e3e66f690.jsonl
---

None

---

OUTPUT NONE if the session is trivially non-architectural (typo, pure Q&A, aborted).

## ADR Kubescape через kustomize build + stdin замість прямого сканування каталогу

## Context and Problem Statement

У пакеті `@nitra/cursor` (`rules/k8s/lint/lint.mjs`) `kubescape scan <dir>` передавав сирий каталог без виконання `kustomize build`. Через це NetworkPolicy з `components/networkpolicy.yaml` (без `metadata.namespace`) бачилася в ізоляції — namespace не інжектувався kustomize-оверлеєм, `podSelector`-match не відбувався, і control C-0260 (`Missing network policy`) спрацьовував хибнопозитивно.

## Considered Options

* Запускати `kustomize build <dir>` і передавати зібраний маніфест у `kubescape scan -` через stdin для кожного buildable Kustomization.
* Залишити прямий `kubescape scan <dir>` (поточна поведінка).

## Decision Outcome

Chosen option: "Запускати `kustomize build <dir>` і передавати результат у `kubescape scan -` через stdin", because kubescape не виконує `kustomize build` самостійно, тому одноразова побудова маніфесту через kustomize усуває хибнопозитивне C-0260 для ресурсів у `components/` без `metadata.namespace`.

### Consequences

* Good, because NetworkPolicy у `k8s/components/` більше не викликає помилкових C-0260 — namespace коректно інжектується kustomize-оверлеєм до сканування.
* Bad, because `kustomize` тепер є обов'язковою залежністю PATH поруч із `kubeconform` і `kubescape`; consumer-репозиторії мусять додати його до CI (крок `Install kustomize` додано до GHA-прикладу в `k8s.mdc`).

## More Information

- Змінено: `npm/rules/k8s/lint/lint.mjs` — додано `findKustomizationDirs` (розрізняє `kind: Kustomization` і `kind: Component`), `runKubescape` переписано на async; стара поведінка (`scan <dir>`) залишена як fallback для дерев без `kustomization.yaml`.
- Тести: `npm/rules/k8s/lint/run-roots.test.mjs` — 2 нових тести для `findKustomizationDirs`; всі 8 тестів проходять.
- Документація: `npm/rules/k8s/k8s.mdc` — версія `1.36` → `1.37`; документовано нову залежність `kustomize` і пайплайн `kustomize build | kubescape scan -`, C-0260 мотивацію, GHA-крок встановлення.
- Версія пакета: `npm/package.json` `1.13.48` → `1.13.49`; запис у `npm/CHANGELOG.md` `[1.13.49] - 2026-05-19`.
- Новий пайплайн: `spawnSync('kustomize', ['build', dir])` → результат через `input:` у `spawnSync('kubescape', ['scan', '-', ...])`.
