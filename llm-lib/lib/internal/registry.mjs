/** @see ./docs/registry.md */

/**
 * Substrate-coupled резолвінг моделей (INTERNAL — не входить у публічний API пакета).
 *
 * Єдине місце, де llm-lib торкається pi ModelRegistry: `getRegistry()` вантажить
 * pi lazy (dynamic import) — top-level import llm-lib-модулів лишається pi-free
 * (тверда межа CI consumers: read-only шлях не вантажить SDK). `resolveModelSpec`
 * повертає pi Model-обʼєкт — саме тому модуль internal: pi-типи не мають виходити
 * за межі пакета (substrate-незалежність публічного API).
 */

import { parseModelId } from '../model-tiers.mjs'

/**
 * Резолвить `"provider/model-id"` у pi Model-обʼєкт через інжектований registry.
 * `createAgentSession` чекає саме Model-обʼєкт (НЕ рядок).
 * @param {{ find: (provider: string, id: string) => object|null|undefined }} registry pi ModelRegistry
 * @param {string} spec `"provider/model-id"`
 * @returns {object|null} pi Model або null (malformed/не знайдено)
 */
export function resolveModelSpec(registry, spec) {
  const parsed = parseModelId(spec)
  if (!parsed) return null
  return Reflect.apply(registry.find, registry, [parsed.provider, parsed.id]) ?? null
}

let _registry = null

/**
 * Lazy singleton pi `ModelRegistry` (вантажить `~/.pi/agent/models.json` + `auth.json`).
 * Кешується на процес.
 * @returns {Promise<object>} pi ModelRegistry
 */
export async function getRegistry() {
  if (_registry) return _registry
  const { ModelRegistry, ModelRuntime } = await import('@earendil-works/pi-coding-agent')
  const runtime = await ModelRuntime.create()
  _registry = new ModelRegistry(runtime)
  return _registry
}
