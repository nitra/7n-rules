/**
 * Тести compressContext: портовано з myllm compress.rs::tests (11 сценаріїв),
 * адаптовано під форму pi Context (messages завжди array-parts, systemPrompt
 * окреме поле, tool-виклик — role:'toolResult'/part type:'toolCall', а не
 * tool_calls/function_call/role:'tool').
 */
import { describe, expect, test } from 'vitest'
import { compressContext } from '../lib/internal/compress-context.mjs'

/**
 * text-message у формі pi Context.
 * @param {string} role user|assistant|toolResult
 * @param {string} text текст єдиної text-part
 * @returns {object} pi message
 */
const msg = (role, text) => ({ role, content: [{ type: 'text', text }] })

/**
 * toolCall-повідомлення (assistant викликає інструмент).
 * @returns {object} pi message з `type:'toolCall'` частиною
 */
const toolCallMsg = () => ({ role: 'assistant', content: [{ type: 'toolCall', id: '1', name: 'f', arguments: {} }] })

/**
 * toolResult-повідомлення (результат виконання інструмента).
 * @param {string} text текст результату
 * @returns {object} pi message з role `toolResult`
 */
const toolResultMsg = text => ({ role: 'toolResult', content: [{ type: 'text', text }] })

/**
 * Pretty-printed JSON-блок заданого розміру (для тестів truncation/minify).
 * @param {number} n довжина внутрішнього рядка `data`
 * @returns {string} JSON-текст із переносами рядків
 */
const bigJson = n => `{\n  "data": "${'x'.repeat(n)}"\n}`

describe('minify (через compressContext, одне text-message)', () => {
  test('мінімізує вбудований pretty-printed JSON-блок', () => {
    const text = 'Запит:\n{\n  "a": 1,\n  "b": [1, 2, 3],\n  "c": "hello world"\n}\n\nдалі текст'
    const out = compressContext({ messages: [msg('user', text), msg('user', 'x'), msg('user', 'y')] })
    const compressedText = out.messages[0].content[0].text
    expect(compressedText).toContain('{"a":1,"b":[1,2,3],"c":"hello world"}')
    expect(compressedText.startsWith('Запит:\n')).toBe(true)
    expect(compressedText.endsWith('далі текст')).toBe(true)
  })

  test('звичайний текст без дужок JSON лишається незмінним', () => {
    const context = { messages: [msg('user', 'звичайний текст без жодних дужок JSON')] }
    expect(compressContext(context)).toBe(context)
  })

  test('ігнорує невалідний JSON-подібний текст у дужках', () => {
    const context = { messages: [msg('user', 'код: { not: valid, json here }')] }
    expect(compressContext(context)).toBe(context)
  })

  test('пропускає короткі JSON-блоки навіть без переносів рядків', () => {
    const context = { messages: [msg('user', 'ok: {"a":1}')] }
    expect(compressContext(context)).toBe(context)
  })
})

describe('tool-payload лишається byte-exact', () => {
  /**
   * 5-message розмова з tool-message і великим старим блоком-кандидатом на truncation.
   * @param {object} toolMessage tool-message для вставки в розмову
   * @returns {object} контекст із messages
   */
  function conversationWithTool(toolMessage) {
    return {
      messages: [
        msg('user', bigJson(6000)),
        toolMessage,
        msg('assistant', 'остання відповідь'),
        msg('user', 'останнє питання')
      ]
    }
  }

  test('toolCall (частина assistant-message) лишається незайманим, решта стискається', () => {
    const toolMessage = toolCallMsg()
    const context = conversationWithTool(toolMessage)
    const out = compressContext(context)
    expect(out.messages[1]).toBe(toolMessage)
    expect(out.messages[0].content[0].text).toContain('truncated')
  })

  test("role:'toolResult' лишається незайманим, решта стискається", () => {
    const toolMessage = toolResultMsg(bigJson(0))
    const context = conversationWithTool(toolMessage)
    const out = compressContext(context)
    expect(out.messages[1]).toBe(toolMessage)
    expect(out.messages[0].content[0].text).toContain('truncated')
  })
})

describe('без messages — no-op', () => {
  test('context без messages повертається як є', () => {
    const context = { model: 'gemma' }
    expect(compressContext(context)).toBe(context)
  })
})

describe('truncation старих блоків і захист хвоста', () => {
  test('мінімізує старе повідомлення і обрізає великий старий блок', () => {
    const context = {
      messages: [msg('user', bigJson(6000)), msg('assistant', 'остання відповідь'), msg('user', 'останнє питання')]
    }
    const out = compressContext(context)
    const oldContent = out.messages[0].content[0].text
    expect(oldContent).toContain('truncated')
    expect(oldContent.length).toBeLessThan(6000)
    expect(out.messages[1].content[0].text).toBe('остання відповідь')
    expect(out.messages[2].content[0].text).toBe('останнє питання')
  })

  test('захищає останні PROTECTED_TAIL_MESSAGES від truncation навіть якщо великі', () => {
    const bigText = bigJson(6000)
    const context = { messages: [msg('user', bigText)] }
    const out = compressContext(context)
    const content = out.messages[0].content[0].text
    expect(content).not.toContain('truncated')
    expect(content.length).toBeLessThan(bigText.length)
  })
})

describe('systemPrompt-поріг', () => {
  test('захищений нижче порогу — нічого стискати (немає JSON, системний захищений)', () => {
    const context = { systemPrompt: 'x'.repeat(6000), messages: [msg('user', 'останнє питання')] }
    expect(compressContext(context)).toBe(context)
  })

  test('над порогом — systemPrompt обрізається, останнє повідомлення недоторкане', () => {
    // originalSize = systemPrompt.length + JSON.stringify(messages).length; підганяємо, щоб
    // перевищити SYSTEM_TRUNCATION_SIZE_THRESHOLD (120_000) великим systemPrompt.
    const context = { systemPrompt: 'x'.repeat(125_000), messages: [msg('user', 'останнє питання')] }
    const out = compressContext(context)
    expect(out.systemPrompt).toContain('truncated')
    expect(out.systemPrompt.length).toBeLessThan(125_000)
    expect(out.messages[0].content[0].text).toBe('останнє питання')
  })
})

describe('multimodal parts', () => {
  test('стискає text-part і не чіпає non-text part (напр. image)', () => {
    const context = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: bigJson(6000) },
            { type: 'image', url: 'data:image/png;base64,AAA' }
          ]
        },
        msg('assistant', 'ok'),
        msg('user', 'ще одне')
      ]
    }
    const out = compressContext(context)
    const parts = out.messages[0].content
    expect(parts[0].text).toContain('truncated')
    expect(parts[1]).toEqual({ type: 'image', url: 'data:image/png;base64,AAA' })
  })
})
