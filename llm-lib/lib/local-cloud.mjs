/**
 * Тип 2a (OpenAI-сумісний API, sync) для Node — прямий HTTP до OpenAI-compatible
 * ендпоінта (`chat/completions`): локальні провайдери (напр. omlx) і хмарні
 * (стандартна автентифікація провайдера) — без агентського циклу.
 *
 * Тонкий JS-клієнт до Rust-крейта `llm_lib::local_cloud` через napi FFI
 * in-process (`llm-lib/crates/llm-lib-napi`) — жодного власного HTTP-клієнта
 * тут (анти-приклад, якого це уникає: `mlmail` читає `~/.omlx/settings.json`
 * і б'є в ендпоінт напряму замість спільної точки, задача T5/рішення Н).
 */
import { loadNative } from './internal/native.mjs'

/**
 * Один chat-виклик Типу 2a. `modelSpecOrTier` — або явний `"provider/model-id"`,
 * або абстрактний тир (`min`/`avg`/`max`, рішення К), що резолвиться в Rust
 * через ту саму [`llm_lib::resolve_model`], що й `resolveModel` з
 * `model-tiers.mjs`.
 * @param {string} modelSpecOrTier `"provider/model-id"` або `'min'|'avg'|'max'`
 * @param {string} prompt user-репліка
 * @param {{
 *   localProviders?: Record<string, { baseUrl: string, apiKey?: string | null }>,
 *   system?: string,
 *   native?: { oneShotLocalCloud: (modelSpecOrTier: string, prompt: string, options?: object) => Promise<string> }
 * }} [options] конфіг локальних провайдерів (`omlx` тощо), system-репліка, інжект `native` для тестів
 * @returns {Promise<string>} текст відповіді моделі
 */
export function oneShotLocalCloud(modelSpecOrTier, prompt, { localProviders, system, native } = {}) {
  const nativeImpl = native ?? loadNative()
  return nativeImpl.oneShotLocalCloud(modelSpecOrTier, prompt, {
    localProviders: localProviders ?? undefined,
    system: system ?? undefined
  })
}
