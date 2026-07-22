/**
 * Канонічний MSW-хелпер для мокання Apollo GraphQL-підписок через `graphql-sse` (storybook.mdc,
 * ADR канон-storybook-для-vue-компонентних-бібліотек, Кластер 3). Wire-протокол
 * `graphql-sse` у distinct-connection режимі — кожна подія виконання підписки надсилається
 * як окремий SSE `next`-запис: `event: next\ndata: <JSON>\n\n`. Одне джерело істини для цього
 * протоколу — не переносити копію логіки в кожен пакет окремо.
 */

/**
 * Формує SSE-стрім тіла відповіді для MSW-хендлера підписки graphql-sse.
 * @param {Array<object>} payloads послідовність GraphQL execution-result payload-ів — кожен
 *   елемент те, що `graphql-sse` надіслав би як окрему `next`-подію одного виконання підписки
 * @returns {ReadableStream<Uint8Array>} SSE body-стрім для MSW-response (`HttpResponse` body)
 */
export function sseSubscription(payloads) {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const payload of payloads) {
        controller.enqueue(encoder.encode(`event: next\ndata: ${JSON.stringify(payload)}\n\n`))
      }
      controller.close()
    }
  })
}
