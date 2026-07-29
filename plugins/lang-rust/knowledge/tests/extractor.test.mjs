import { Buffer } from 'node:buffer'

import { describe, expect, test } from 'vitest'

import rustKnowledgeExtractor, { analyzeFile } from '../extractor.mjs'

/**
 * Створює immutable source evidence для Rust extractor-а.
 * @param {string} path repo-relative source path
 * @param {string} content Rust source
 * @returns {{ domain: object, file: { path: string, content: string, contentHash: string } }} adapter input
 */
function input(path, content) {
  return { domain: { id: 'cargo:fixture' }, file: { path, content, contentHash: `hash:${path}` } }
}

describe('knowledge.extractor@1 Rust adapter', () => {
  test('декларує versioned Tree-sitter WASM contract для .rs', () => {
    expect(rustKnowledgeExtractor).toMatchObject({
      id: 'knowledge-rust',
      apiVersion: 1,
      extensions: ['.rs'],
      parser: { id: 'tree-sitter-rust-wasm', grammarVersion: 'tree-sitter-rust-0.24.0' }
    })
  })

  test('будує public/private units, AST imports і local/opaque call edges', async () => {
    const content = [
      'use crate::storage::{persist, Store};',
      'use reqwest::Client as HttpClient;',
      'pub struct Service;',
      'pub fn submit(замовлення: &str) {',
      '  helper(замовлення);',
      '  persist(замовлення);',
      '  HttpClient::new();',
      '}',
      'fn helper(value: &str) { let _ = value; }',
      'impl Service {',
      '  pub fn run(&self) { helper("ok"); }',
      '  fn internal(&self) {}',
      '}'
    ].join('\n')
    const result = await analyzeFile(input('src/service.rs', content))

    expect(result).toMatchObject({ ok: true, file: { path: 'src/service.rs', language: 'rust' } })
    expect(result.units.map(unit => unit.name)).toEqual(['Service', 'submit', 'helper', 'run', 'internal'])
    expect(result.units.find(unit => unit.name === 'submit')).toMatchObject({
      visibility: 'public',
      localId: 'unit:submit:0'
    })
    expect(result.units.find(unit => unit.name === 'helper')).toMatchObject({ visibility: 'private' })
    expect(result.units.find(unit => unit.name === 'run')).toMatchObject({
      visibility: 'public',
      localId: 'unit:Service::run:0'
    })
    expect(result.units.find(unit => unit.name === 'internal')).toMatchObject({ visibility: 'private' })
    expect(result.units.find(unit => unit.name === 'submit').span.startByte).toBe(
      Buffer.byteLength(content.slice(0, content.indexOf('pub fn submit')), 'utf8')
    )
    expect(result.imports).toEqual([
      expect.objectContaining({
        specifier: 'crate::storage::{persist, Store}',
        bindings: expect.arrayContaining([
          expect.objectContaining({ localName: 'persist', importedName: 'crate::storage::persist' })
        ])
      }),
      expect.objectContaining({
        specifier: 'reqwest::Client as HttpClient',
        bindings: [{ localName: 'HttpClient', importedName: 'reqwest::Client' }]
      })
    ])
    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'integrates',
          fromLocalId: 'unit:submit:0',
          to: { unresolvedSpecifier: 'crate::storage::persist', opaque: true }
        }),
        expect.objectContaining({
          kind: 'integrates',
          fromLocalId: 'unit:submit:0',
          to: { unresolvedSpecifier: 'reqwest::Client', opaque: true }
        }),
        expect.objectContaining({
          kind: 'invokes',
          fromLocalId: 'unit:Service::run:0',
          to: { localId: 'unit:helper:0' }
        }),
        expect.objectContaining({ kind: 'invokes', fromLocalId: 'unit:submit:0', to: { localId: 'unit:helper:0' } })
      ])
    )
    expect(result.entryPoints).toEqual([
      { localId: 'unit:Service:0', reason: 'pub' },
      { localId: 'unit:submit:0', reason: 'pub' },
      { localId: 'unit:Service::run:0', reason: 'pub' }
    ])
    expect(result.chunks).toHaveLength(5)
    expect(result.coverage).toEqual({
      requiredUnits: 5,
      coveredUnits: 5,
      requiredEdges: 4,
      coveredEdges: 4,
      complete: true
    })
  })

  test('UTF-8 spans лишаються byte-stable для unicode перед declaration-ом', async () => {
    const content = '// український префікс\npub fn café() {}'
    const result = await analyzeFile(input('src/unicode.rs', content))

    expect(result).toMatchObject({ ok: true })
    expect(result.units).toEqual([
      expect.objectContaining({
        name: 'café',
        span: {
          startByte: Buffer.byteLength('// український префікс\n', 'utf8'),
          endByte: Buffer.byteLength(content, 'utf8')
        }
      })
    ])
  })

  test('malformed Rust повертає blocking parse diagnostic без partial graph', async () => {
    const result = await analyzeFile(input('src/broken.rs', 'pub fn broken( {'))

    expect(result).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'parse-error', path: 'src/broken.rs' })]
    })
    expect(result).not.toHaveProperty('units')
  })

  test('unsupported extension повертає явний blocking diagnostic', async () => {
    await expect(analyzeFile(input('src/not-rust.txt', 'text'))).resolves.toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'unsupported-extension', path: 'src/not-rust.txt' })]
    })
  })
})
