/**
 * Єдиний renderer unified lint surface. Detector-и НЕ друкують основний violation-report —
 * вони повертають `LintResult`, а runner рендерить тут. Це гарантує однаковий вигляд
 * для всіх concern-ів і єдину точку форматування.
 *
 * `renderViolations` — тонкий JS-фасад над native
 * `rules_core::lint_render::render_violations` (R1 фази 7, другий зріз
 * `docs/specs/2026-07-30-rules-v2-rust-core-migration.md` §4): точний
 * текстовий формат і insertion-order групування портовані в
 * `crates/rules-core/src/lint_render.rs`, doc-комент там-таки. JS-реалізацію
 * видалено після parity-гейту (диференційний тест
 * `tests/lint-render-native-parity.test.mjs`).
 * @typedef {import('./types.mjs').LintViolation} LintViolation
 * @typedef {import('./types.mjs').LintDiagnostic} LintDiagnostic
 */
import { loadNative } from '../native.mjs'

/**
 * Рендерить порушення згруповані за concern-ом. Повертає текст (не друкує сам).
 * НЕ сортує (той самий контракт, що й видалена JS-версія) — викликачі
 * (`default-worker.mjs`/`run-fix.mjs`) передають вже вузькі, не глобально
 * відсортовані підмножини; глобальне сортування для `detectAll` рахує
 * окремий комбінований native-виклик `sortAndRenderViolations`
 * (`run-detectors.mjs`).
 * @param {LintViolation[]} violations перелік порушень для рендеру.
 * @returns {string} згрупований текст порушень (порожній рядок, якщо їх немає).
 */
export function renderViolations(violations) {
  return loadNative().renderViolations(violations)
}

/**
 * Рендерить diagnostics (тех. інфа) — лише у verbose.
 * @param {LintDiagnostic[]} diagnostics перелік diagnostics для рендеру.
 * @returns {string} текст diagnostics (порожній рядок, якщо їх немає).
 */
export function renderDiagnostics(diagnostics) {
  if (diagnostics.length === 0) return ''
  return diagnostics.map(d => `  ${d.level === 'warn' ? '⚠' : 'ℹ'} ${d.message}`).join('\n') + '\n'
}
