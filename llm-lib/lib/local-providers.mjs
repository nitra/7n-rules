/**
 * Дефолтна мапа local-провайдерів для Rust-крейта `llm_lib::local_cloud`
 * (той самий `{ prefix: { baseUrl, apiKey } }` конфіг, що приймає
 * `oneShotLocalCloud`/`submitBatch`). Один generic-слот `local-openai`
 * покриває БУДЬ-ЯКИЙ кастомний OpenAI-сумісний сервер (omlx, litellm-проксі,
 * TurboFieldfareServer, майбутні) — одним спільним `N_LOCAL_OPENAI_*`-env
 * замість окремої env-пари на кожен сервер.
 *
 * **Свідома відмова від окремих `omlx`/`litellm`-записів (та їхньої
 * можливості діяти одночасно через різні tier-env, напр.
 * `N_LOCAL_MIN_MODEL=omlx/...` + `N_LOCAL_AVG_MODEL=litellm/...`)** —
 * generic-слот залишає активним лише один `baseUrl` за раз, перемикання
 * між серверами — переналаштуванням `N_LOCAL_OPENAI_BASE_URL`. Це свідомий
 * breaking change: model-spec-префікс `"omlx/..."` більше не резолвиться —
 * усі конфіги мають мігрувати на `"local-openai/..."` (nitra/7n-rules#374).
 *
 * **Навмисно не `openai`**: цей рядок — literal cloud-provider prefix, який
 * `local_cloud.rs` (і genai) розпізнають як справжній хмарний OpenAI (напр.
 * `N_CLOUD_MIN_MODEL=openai/gpt-5.4-mini`) — реєстрація `openai` в
 * local-мапі тихо перехопила б такі cloud-виклики на локальний baseUrl.
 */
import { env } from 'node:process'

/**
 * @returns {{
 *   'local-openai': { baseUrl: string, apiKey: string|null }
 * }} дефолтна мапа локальних провайдерів (override — через
 * `N_LOCAL_OPENAI_BASE_URL`/`N_LOCAL_OPENAI_API_KEY`; дефолтний `baseUrl` —
 * локальний omlx-порт `http://127.0.0.1:8000/v1/`, найбезпечніший
 * zero-config дефолт — без мережі, без зовнішньої залежності)
 */
export function defaultLocalProviders() {
  return {
    'local-openai': {
      baseUrl: env.N_LOCAL_OPENAI_BASE_URL ?? 'http://127.0.0.1:8000/v1/',
      apiKey: env.N_LOCAL_OPENAI_API_KEY ?? null
    }
  }
}
