/**
 * T0-autofix для `k8s/manifests` — детерміновані правки без LLM.
 *
 * Покриває: `gateway-httproute-v1beta1` — auto-upgrade
 * `apiVersion: gateway.networking.k8s.io/v1beta1` → `gateway.networking.k8s.io/v1`
 * і `$schema httproute_v1beta1.json` → `httproute_v1.json` для `kind: HTTPRoute`.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { replaceGatewayHttpRouteV1beta1ApiVersionInYamlText } from './main.mjs'

/**
 * @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]}
 */
export const patterns = [
  {
    id: 'k8s-manifests-gateway-httproute-v1beta1',
    test: violations => violations.some(v => v.data?.kind === 'gateway-httproute-v1beta1' && v.file),
    apply: (violations, ctx) => {
      const files = [
        ...new Set(violations.filter(v => v.data?.kind === 'gateway-httproute-v1beta1' && v.file).map(v => v.file))
      ]
      /** @type {string[]} */
      const touchedFiles = []
      for (const rel of files) {
        const abs = join(ctx.cwd, rel)
        let raw
        try {
          raw = readFileSync(abs, 'utf8')
        } catch {
          continue
        }
        const { changed, content } = replaceGatewayHttpRouteV1beta1ApiVersionInYamlText(raw)
        if (changed) {
          ctx.recordWrite?.(abs)
          writeFileSync(abs, content)
          touchedFiles.push(abs)
        }
      }
      return touchedFiles.length > 0
        ? {
            touchedFiles,
            message: `gateway HTTPRoute apiVersion v1beta1 → v1: ${touchedFiles.length} файл(ів)`
          }
        : { touchedFiles: [] }
    }
  }
]
