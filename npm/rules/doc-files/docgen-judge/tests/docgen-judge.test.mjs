import { describe, expect, test } from 'vitest'

import { JUDGE_CONFIDENCE, detectRefusalFiller, judgeFailsDoc, parseDocVerdict } from '../main.mjs'

describe('parseDocVerdict', () => {
  test('витягує valid verdict з обрамленого тексту', () => {
    const v = parseDocVerdict('бла {"verdict":"inaccurate","confidence":0.9,"reason":"wrong return"} кінець')
    expect(v).toEqual({ verdict: 'inaccurate', confidence: 0.9, reason: 'wrong return' })
  })

  test('нема JSON → throws', () => {
    expect(() => parseDocVerdict('no json here')).toThrow()
  })

  test('невідомий verdict → throws', () => {
    expect(() => parseDocVerdict('{"verdict":"maybe","confidence":0.5,"reason":"x"}')).toThrow()
  })

  test('confidence поза [0,1] → throws', () => {
    expect(() => parseDocVerdict('{"verdict":"accurate","confidence":2,"reason":"x"}')).toThrow()
  })
})

describe('judgeFailsDoc', () => {
  test('inaccurate ≥ поріг → true', () => {
    expect(judgeFailsDoc({ verdict: 'inaccurate', confidence: JUDGE_CONFIDENCE })).toBe(true)
  })

  test('inaccurate нижче порога → false', () => {
    expect(judgeFailsDoc({ verdict: 'inaccurate', confidence: 0.1 })).toBe(false)
  })

  test('accurate (навіть високий confidence) → false', () => {
    expect(judgeFailsDoc({ verdict: 'accurate', confidence: 0.99 })).toBe(false)
  })

  test('generic → false (scope лише inaccurate)', () => {
    expect(judgeFailsDoc({ verdict: 'generic', confidence: 0.99 })).toBe(false)
  })

  test('null → false', () => {
    expect(judgeFailsDoc(null)).toBe(false)
  })
})

describe('detectRefusalFiller — детермінований пре-гейт (issue #16)', () => {
  test('живий кейс gemma: «Я готовий писати… Надайте мені код» → зловлено', () => {
    const filler =
      '## Огляд\n\nЯ готовий писати поведінкову документацію для вашого файлу. ' +
      'Надайте мені код, і я створю розділи.\n'
    expect(detectRefusalFiller(filler)).toBeTruthy()
  })

  test('окремі refusal-фрази (укр/англ) → зловлено', () => {
    for (const s of [
      'Будь ласка, надайте вміст файлу.',
      'Не можу згенерувати документацію без коду.',
      'Чекаю на код для аналізу.',
      'As an AI model, I cannot inspect files.',
      "I'm ready to write the documentation.",
      'Please provide the code first.'
    ]) {
      expect(detectRefusalFiller(s)).toBeTruthy()
    }
  })

  test('живий кейс 2026-07-21 (storybook): «мені потрібен сам код» у тілі доки → зловлено', () => {
    const leaked =
      '## Поведінка\n\nМодуль обробляє список файлів. ' +
      'Щоб написати точну документацію, мені потрібен сам код модуля з усіма функціями.\n'
    expect(detectRefusalFiller(leaked)).toBeTruthy()
    // варіації тієї ж родини
    for (const s of [
      'Мені потрібно код файлу для продовження.',
      'Нам потрібен вміст модуля.',
      'I need the source code to document this file.'
    ]) {
      expect(detectRefusalFiller(s)).toBeTruthy()
    }
  })

  test('нормальна поведінкова дока → null', () => {
    const normal =
      '## Огляд\n\nПеревіряє наявність bun.lock і забороняє yarn.lock у корені монорепо.\n\n' +
      '## Поведінка\n\n1. Шукає заборонені lockfile-и.\n2. Готовий список порушень повертає викликачу.\n'
    expect(detectRefusalFiller(normal)).toBeNull()
  })

  test('третя особа про залежності коду («скрипту потрібен файл…») → null (без мені/нам)', () => {
    const normal =
      '## Поведінка\n\nСкрипту потрібен файл конфігурації `.n-rules.json`; ' +
      'без нього обробка завершується помилкою. Для запуску потрібен код виходу 0 від препроцесора.\n'
    expect(detectRefusalFiller(normal)).toBeNull()
  })
})
