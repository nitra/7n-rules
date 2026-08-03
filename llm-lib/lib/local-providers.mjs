/**
 * Дефолтна мапа local-провайдерів для Rust-крейта `llm_lib::local_cloud`
 * (той самий `{ prefix: { baseUrl, apiKey } }` конфіг, що приймає
 * `oneShotLocalCloud`/`submitBatch`). Обидва зареєстровані провайдери
 * (`omlx`, `local-openai`) завжди присутні в мапі одночасно — "активність"
 * визначається лише тим, чий provider-префікс реально стоїть у
 * model-spec (`N_LOCAL_MIN_MODEL` тощо): `LocalCloud::one_shot_with_spec`
 * б'є рівно в один клієнт за префіксом spec, тож другий запис у мапі
 * ніколи не отримує запиту, поки на нього не вказує жоден spec.
 *
 * `local-openai` — generic-слот для БУДЬ-ЯКОГО кастомного OpenAI-сумісного
 * сервера (litellm-проксі, TurboFieldfareServer, майбутні), одним спільним
 * `N_LOCAL_OPENAI_*`-env замість окремого env-пари на кожен новий сервер.
 * **Навмисно не `openai`**: цей рядок — literal cloud-provider prefix, який
 * `local_cloud.rs` (і genai) розпізнають як справжній хмарний OpenAI (напр.
 * `N_CLOUD_MIN_MODEL=openai/gpt-5.4-mini`) — реєстрація `openai` в
 * local-мапі тихо перехопила б такі cloud-виклики на локальний baseUrl.
 */
import { env } from 'node:process'

/**
 * @returns {{
 *   omlx: { baseUrl: string, apiKey: string|null },
 *   'local-openai': { baseUrl: string, apiKey: string|null }
 * }} дефолтна мапа локальних провайдерів (override окремих полів — через
 * `N_OMLX_BASE_URL`/`N_OMLX_API_KEY`/`N_LOCAL_OPENAI_BASE_URL`/
 * `N_LOCAL_OPENAI_API_KEY`; для omlx приймається і без префікса
 * `OMLX_API_KEY` — це власна конвенція самого сервера (omlx-server читає
 * `OMLX_API_KEY` для свого auth), тож розробницьке оточення природно
 * експортує саме її; `N_`-префіксоване значення має пріоритет. `local-openai`
 * такої конвенції не має — лише `N_`-префікс, бо це generic-слот, не
 * конкретний сервер)
 */
export function defaultLocalProviders() {
  return {
    omlx: {
      baseUrl: env.N_OMLX_BASE_URL ?? 'http://127.0.0.1:8000/v1/',
      apiKey: env.N_OMLX_API_KEY ?? env.OMLX_API_KEY ?? null
    },
    'local-openai': {
      baseUrl: env.N_LOCAL_OPENAI_BASE_URL ?? 'https://llm.7n.ai/v1/',
      apiKey: env.N_LOCAL_OPENAI_API_KEY ?? null
    }
  }
}
