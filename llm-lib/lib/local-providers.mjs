/**
 * Дефолтна мапа local-провайдерів для Rust-крейта `llm_lib::local_cloud`
 * (той самий `{ prefix: { baseUrl, apiKey } }` конфіг, що приймає
 * `oneShotLocalCloud`/`submitBatch`). Усі зареєстровані провайдери
 * (`omlx`, `litellm`, `turbofieldfare`) завжди присутні в мапі одночасно —
 * "активність" визначається лише тим, чий provider-префікс реально стоїть у
 * model-spec (`N_LOCAL_MIN_MODEL` тощо): `LocalCloud::one_shot_with_spec`
 * б'є рівно в один клієнт за префіксом spec, тож інші записи в мапі
 * ніколи не отримують запиту, поки на них не вказує жоден spec.
 */
import { env } from 'node:process'

/**
 * @returns {{
 *   omlx: { baseUrl: string, apiKey: string|null },
 *   litellm: { baseUrl: string, apiKey: string|null },
 *   turbofieldfare: { baseUrl: string, apiKey: string|null }
 * }} дефолтна мапа локальних провайдерів (override окремих полів — через
 * `N_OMLX_BASE_URL`/`N_OMLX_API_KEY`/`N_LITELLM_BASE_URL`/`N_LITELLM_API_KEY`/
 * `N_TURBOFIELDFARE_BASE_URL`/`N_TURBOFIELDFARE_API_KEY`; для API-ключів
 * omlx/litellm приймаються і без префікса `OMLX_API_KEY`/`LITELLM_API_KEY` —
 * це власна конвенція самих серверів (omlx-server читає `OMLX_API_KEY` для свого
 * auth), тож розробницьке оточення природно експортує саме її; `N_`-префіксовані
 * значення мають пріоритет. TurboFieldfareServer (Swift, OpenAI-сумісний
 * `/v1/chat/completions` + `/v1/models`) не має власної auth-конвенції —
 * лише `N_`-префікс)
 */
export function defaultLocalProviders() {
  return {
    omlx: {
      baseUrl: env.N_OMLX_BASE_URL ?? 'http://127.0.0.1:8000/v1/',
      apiKey: env.N_OMLX_API_KEY ?? env.OMLX_API_KEY ?? null
    },
    litellm: {
      baseUrl: env.N_LITELLM_BASE_URL ?? 'https://llm.7n.ai/v1/',
      apiKey: env.N_LITELLM_API_KEY ?? env.LITELLM_API_KEY ?? null
    },
    turbofieldfare: {
      baseUrl: env.N_TURBOFIELDFARE_BASE_URL ?? 'http://127.0.0.1:8080/v1/',
      apiKey: env.N_TURBOFIELDFARE_API_KEY ?? null
    }
  }
}
