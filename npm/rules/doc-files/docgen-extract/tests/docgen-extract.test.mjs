import { describe, expect, test } from 'vitest'

import { extractFacts } from '../main.mjs'

const caches = src => extractFacts(src, 'x.mjs').markers.caches
const symbols = src => extractFacts(src, 'x.mjs').localSymbols

describe('markers.caches — лише іменований cache/memo-маркер, не будь-який new Map() (R2)', () => {
  test('акумулятор new Map() не вважається кешем', () => {
    expect(caches('const byPath = new Map()\n')).toBe(false)
  })

  test('іменований cache-ідентифікатор → кеш', () => {
    expect(caches('function go(walkCache) {}\n')).toBe(true)
  })

  test('memoize → кеш', () => {
    expect(caches('const memoize = fn => fn\n')).toBe(true)
  })

  test('файл без кешу → false', () => {
    expect(caches('export const a = 1\n')).toBe(false)
  })
})

describe('localSymbols — неекспортовані top-level функції/класи (R6)', () => {
  test('службова функція потрапляє, експортована — ні', () => {
    const src = 'export function check() {}\nfunction helper() {}\nclass Inner {}\n'
    const ls = symbols(src)
    expect(ls).toContain('helper')
    expect(ls).toContain('Inner')
    expect(ls).not.toContain('check')
  })

  test('файл лише з експортами → порожньо', () => {
    expect(symbols('export const a = 1\nexport function b() {}\n')).toEqual([])
  })
})

describe('Rust (.rs) — extractFactsRust', () => {
  const rsPath = 'src/lib.rs'
  const facts = src => extractFacts(src, rsPath)

  test('lang=rs', () => {
    expect(facts('fn main() {}\n').lang).toBe('rs')
  })

  test('pub fn → exports', () => {
    const src = `
/// Ініціює сервер.
pub fn run() {}
fn helper() {}
`
    const f = facts(src)
    expect(f.exports.map(e => e.name)).toContain('run')
    expect(f.exports.map(e => e.name)).not.toContain('helper')
    expect(f.localSymbols).toContain('helper')
  })

  test('#[tauri::command] fn → exports навіть без pub', () => {
    const src = `
#[tauri::command]
fn scan_tasks() -> Result<Vec<String>, String> {}
`
    const f = facts(src)
    expect(f.exports.map(e => e.name)).toContain('scan_tasks')
  })

  test('pub struct і pub enum → exports', () => {
    const src = `
pub struct Task { id: u32 }
pub enum Status { Done, Pending }
struct Internal {}
`
    const f = facts(src)
    const names = f.exports.map(e => e.name)
    expect(names).toContain('Task')
    expect(names).toContain('Status')
    expect(names).not.toContain('Internal')
  })

  test('markers.returnsFalsyOnFail: -> Result<', () => {
    expect(facts('pub fn f() -> Result<String, String> {}\n').markers.returnsFalsyOnFail).toBe(true)
    expect(facts('pub fn f() -> String {}\n').markers.returnsFalsyOnFail).toBe(false)
  })

  test('markers.catchesErrors: .map_err/.unwrap_or/.ok()', () => {
    expect(facts('let x = foo().map_err(|e| e);\n').markers.catchesErrors).toBe(true)
    expect(facts('pub fn f() {}\n').markers.catchesErrors).toBe(false)
  })

  test('markers.readOnly: нема fs-write → true', () => {
    expect(facts('use std::fs;\nfn r() { fs::read("x") }\n').markers.readOnly).toBe(true)
  })

  test('markers.readOnly: fs::write → false', () => {
    expect(facts('fn w() { std::fs::write("f", b"x") }\n').markers.readOnly).toBe(false)
  })

  test('header з //! inner doc', () => {
    const src = `//! Основний модуль Tauri-застосунку.\nuse std::fs;\n`
    expect(facts(src).header).toBe('Основний модуль Tauri-застосунку.')
  })

  test('/// doc-коментар → desc exports', () => {
    const src = `
/// Запускає сканування.
pub fn scan() {}
`
    const f = facts(src)
    const ex = f.exports.find(e => e.name === 'scan')
    expect(ex?.desc).toBe('Запускає сканування.')
  })
})
