/**
 * Дефолтна мапа local-провайдерів для Rust-крейта `llm_lib::local_cloud`
 * (той самий `{ prefix: { baseUrl, apiKey } }` конфіг, що приймає
 * `oneShotLocalCloud`/`submitBatch`). Обидва зареєстровані провайдери
 * (`omlx`, `litellm`) завжди присутні в мапі одночасно — "активність"
 * визначається лише тим, чий provider-префікс реально стоїть у
 * model-spec (`N_LOCAL_MIN_MODEL` тощо): `LocalCloud::one_shot_with_spec`
 * б'є рівно в один клієнт за префіксом spec, тож другий запис у мапі
 * ніколи не отримує запиту, поки на нього не вказує жоден spec.
 */
import { env } from 'node:process'

/**
 * @returns {{
 *   omlx: { baseUrl: string, apiKey: string|null },
 *   litellm: { baseUrl: string, apiKey: string|null }
 * }} дефолтна мапа локальних провайдерів (override окремих полів — через
 * `N_OMLX_BASE_URL`/`N_OMLX_API_KEY`/`N_LITELLM_BASE_URL`/`N_LITELLM_API_KEY`)
 */
export function defaultLocalProviders() {
  return {
    omlx: {
      baseUrl: env.N_OMLX_BASE_URL ?? 'http://127.0.0.1:8000/v1/',
      apiKey: env.N_OMLX_API_KEY ?? null
    },
    litellm: {
      baseUrl: env.N_LITELLM_BASE_URL ?? 'https://llm.7n.ai/v1/',
      apiKey: env.N_LITELLM_API_KEY ?? null
    }
  }
}
