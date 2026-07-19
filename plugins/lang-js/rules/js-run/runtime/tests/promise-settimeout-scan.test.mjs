/**
 * Модульні тести AST-сканера паттерна `new Promise(resolve => setTimeout(resolve, ms))`
 * для js-run.mdc, секція «Паузи через setTimeout». Парсер — oxc-parser.
 */
import { describe, expect, test } from 'vitest'

import { findPromiseSetTimeoutInText, isPromiseSetTimeoutScanSourceFile } from '../../lib/promise-settimeout-scan.mjs'

describe('promise-settimeout-scan (oxc)', () => {
  test('await new Promise(r => setTimeout(r, 500)) — порушення', () => {
    const hits = findPromiseSetTimeoutInText(`await new Promise(resolve => setTimeout(resolve, 500))\n`, 'x.ts')
    expect(hits.length).toBe(1)
    expect(hits[0].line).toBe(1)
  })

  test('без await — все одно порушення (інших легітимних застосувань паттерна нема)', () => {
    const hits = findPromiseSetTimeoutInText(`const p = new Promise(r => setTimeout(r, 100))\n`, 'x.js')
    expect(hits.length).toBe(1)
  })

  test('block-body форма: new Promise(r => { setTimeout(r, 1000) })', () => {
    const hits = findPromiseSetTimeoutInText(`await new Promise(r => { setTimeout(r, 1000) })\n`, 'x.ts')
    expect(hits.length).toBe(1)
  })

  test('function expression: new Promise(function (r) { setTimeout(r, 50) })', () => {
    const hits = findPromiseSetTimeoutInText(
      `await new Promise(function (resolve) { setTimeout(resolve, 50) })\n`,
      'x.ts'
    )
    expect(hits.length).toBe(1)
  })

  test('обгорнутий arrow: new Promise(r => setTimeout(() => r(), 200))', () => {
    const hits = findPromiseSetTimeoutInText(`await new Promise(r => setTimeout(() => r(), 200))\n`, 'x.ts')
    expect(hits.length).toBe(1)
  })

  test('імпорт promise-варіанта setTimeout — без порушень', () => {
    const src = [`import { setTimeout } from 'node:timers/promises'`, ``, `await setTimeout(500)`, ``].join('\n')
    expect(findPromiseSetTimeoutInText(src, 'x.ts').length).toBe(0)
  })

  test('Promise з логікою (не таймер) — без порушень', () => {
    const src = `await new Promise((resolve, reject) => fetch('/x').then(resolve, reject))\n`
    expect(findPromiseSetTimeoutInText(src, 'x.ts').length).toBe(0)
  })

  test('Promise з resolve(value) у callback — поза паттерном (передає значення)', () => {
    const src = `await new Promise(r => setTimeout(() => r(42), 500))\n`
    expect(findPromiseSetTimeoutInText(src, 'x.ts').length).toBe(0)
  })

  test('setTimeout без resolve у першому аргументі — поза паттерном', () => {
    const src = `await new Promise(resolve => setTimeout(otherCb, 500))\n`
    expect(findPromiseSetTimeoutInText(src, 'x.ts').length).toBe(0)
  })

  test('кілька стейтментів у блоці — поза паттерном (не «чиста» пауза)', () => {
    const src = `await new Promise(r => { log('wait'); setTimeout(r, 500) })\n`
    expect(findPromiseSetTimeoutInText(src, 'x.ts').length).toBe(0)
  })

  test('multiline зберігає номер рядка початку NewExpression', () => {
    const src = [`// header`, `await new Promise(`, `  resolve => setTimeout(resolve, 1000)`, `)`, ``].join('\n')
    const hits = findPromiseSetTimeoutInText(src, 'x.ts')
    expect(hits.length).toBe(1)
    expect(hits[0].line).toBe(2)
  })

  test('кілька входжень в одному файлі — кожне порушення окремо', () => {
    const src = [
      `await new Promise(r => setTimeout(r, 100))`,
      `const p = new Promise(r => setTimeout(r, 200))`,
      ``
    ].join('\n')
    const hits = findPromiseSetTimeoutInText(src, 'x.ts')
    expect(hits.length).toBe(2)
  })

  test("isPromiseSetTimeoutScanSourceFile — JS/TS-сім'я, без .d.ts", () => {
    expect(isPromiseSetTimeoutScanSourceFile('src/a.ts')).toBe(true)
    expect(isPromiseSetTimeoutScanSourceFile('src/a.mjs')).toBe(true)
    expect(isPromiseSetTimeoutScanSourceFile('src/a.tsx')).toBe(true)
    expect(isPromiseSetTimeoutScanSourceFile('src/a.json')).toBe(false)
    expect(isPromiseSetTimeoutScanSourceFile('src/a.d.ts')).toBe(false)
  })
})
