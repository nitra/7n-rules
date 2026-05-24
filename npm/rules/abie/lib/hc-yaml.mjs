/**
 * Валідація modeline у `hc.yaml` для abie.
 * Per-document структурна валідація `HealthCheckPolicy` живе у
 * `policy/health_check_policy/health_check_policy.rego` (CLI прогонить через target.json).
 */
import { LINE_SPLIT_RE, MODELINE_RE, stripBom } from './yaml.mjs'

/** Очікуваний URL `$schema` для **hc.yaml** (abie.mdc). */
export const ABIE_HC_SCHEMA_URL = 'https://datreeio.github.io/CRDs-catalog/networking.gke.io/healthcheckpolicy_v1.json'

/**
 * Перевіряє modeline (`# yaml-language-server: $schema=...`) у `hc.yaml`.
 * @param {string} raw вміст файла
 * @param {string} relPath відносний шлях (для повідомлень)
 * @returns {string | null} текст помилки або null, якщо OK
 */
export function validateAbieHcModeline(raw, relPath) {
  const body = stripBom(raw)
  const lines = body.split(LINE_SPLIT_RE)
  if (lines.length === 0 || lines[0].trim() === '') {
    return `${relPath}: перший рядок порожній — потрібен # yaml-language-server: $schema=… (abie.mdc)`
  }
  const m = lines[0].match(MODELINE_RE)
  if (!m) return `${relPath}: перший рядок має бути modeline $schema (abie.mdc)`
  if (m[1] !== ABIE_HC_SCHEMA_URL) return `${relPath}: $schema має бути\n     ${ABIE_HC_SCHEMA_URL}\n     (abie.mdc)`
  return null
}
