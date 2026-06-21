/** @see ./docs/lint.md */
import { runLintK8s } from '../lint/lint.mjs'

/**
 * Оркестраторний адаптер `n-cursor lint k8s` (лінтер-фаза): kubeconform + kubescape по деревах
 * `.../k8s/*.yaml` через `runLintK8s` (read-only тули — мутацій немає, тож `opts` ігнорується).
 * Структурні k8s.mdc-перевірки (manifest/kustomization/network_policy) — у конформність-фазі.
 * Без `.../k8s`-маніфестів крок — no-op.
 * @param {string[] | undefined} _files ігнорується (whole-repo обхід `.../k8s`)
 * @returns {Promise<number>} exit code
 */
export function lint(_files) {
  return runLintK8s()
}
