import { describe, it, expect } from 'vitest'
import { extractExportsWithComplexity } from '../fix/classify-exports.mjs'

describe('extractExportsWithComplexity', () => {
  it('returns empty array for content with no exports', () => {
    for (const content of ['', 'const x = 1', '*', 'hello world', '{']) {
      expect(extractExportsWithComplexity(content)).toEqual([])
    }
  })

  it('classifies primitive constant as trivial', () => {
    const content = `export const MAX_LEN = 4096`
    const result = extractExportsWithComplexity(content)
    expect(result).toEqual([{ name: 'MAX_LEN', complexity: 'trivial' }])
  })

  it('classifies string constant as trivial', () => {
    const content = `export const MODE = 'MarkdownV2'`
    const result = extractExportsWithComplexity(content)
    expect(result).toEqual([{ name: 'MODE', complexity: 'trivial' }])
  })

  it('classifies boolean constant as trivial', () => {
    const content = `export const DEBUG = false`
    expect(extractExportsWithComplexity(content)).toEqual([{ name: 'DEBUG', complexity: 'trivial' }])
  })

  it('classifies pure function with no signals as simple', () => {
    const content = `export function escapeMarkdown(str) {\n  return str.replace(/[*]/g, '\\\\$&')\n}`
    const result = extractExportsWithComplexity(content)
    expect(result).toEqual([{ name: 'escapeMarkdown', complexity: 'simple' }])
  })

  it('classifies function using fetch as complex', () => {
    const content = `export async function sendMessage(text) {\n  return fetch('/api', { body: text })\n}`
    const result = extractExportsWithComplexity(content)
    expect(result).toEqual([{ name: 'sendMessage', complexity: 'complex' }])
  })

  it('classifies function using new Date as complex', () => {
    const content = `export function getHour() {\n  return new Date().getHours()\n}`
    const result = extractExportsWithComplexity(content)
    expect(result).toEqual([{ name: 'getHour', complexity: 'complex' }])
  })

  it('classifies function using process.env as complex', () => {
    const content = `export function getToken() {\n  return process.env.API_TOKEN\n}`
    const result = extractExportsWithComplexity(content)
    expect(result).toEqual([{ name: 'getToken', complexity: 'complex' }])
  })

  it('classifies function using FormData as complex', () => {
    const content = `export function makeForm(doc) {\n  const fd = new FormData()\n  fd.append('doc', doc)\n  return fd\n}`
    const result = extractExportsWithComplexity(content)
    expect(result).toEqual([{ name: 'makeForm', complexity: 'complex' }])
  })

  it('classifies multiple exports with mixed complexity', () => {
    const content = [
      `export const MAX = 100`,
      `export function escape(s) { return s.replace(/x/, '') }`,
      `export async function send(msg) { return fetch('/send', { body: msg }) }`
    ].join('\n')

    const result = extractExportsWithComplexity(content)
    expect(result).toEqual([
      { name: 'MAX', complexity: 'trivial' },
      { name: 'escape', complexity: 'simple' },
      { name: 'send', complexity: 'complex' }
    ])
  })

  it('classifies arrow function without complex signals as simple', () => {
    const content = `export const double = (n) => n * 2`
    const result = extractExportsWithComplexity(content)
    // Arrow assigned to const — not a trivial literal, body has no complex signals
    expect(result[0].name).toBe('double')
    expect(result[0].complexity).toBe('simple')
  })

  it('classifies function using timers as complex', () => {
    const content = `export async function timed() {\n  setTimeout(() => {}, 100)\n}`
    expect(extractExportsWithComplexity(content)).toEqual([{ name: 'timed', complexity: 'complex' }])
  })
})
