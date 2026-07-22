import { describe, expect, test } from 'vitest'

import { parseAst } from '../lib/parse-ast.mjs'

const PARSE_ERROR_RE = /parse error/

describe('parseAst (oxc-адаптер rollup/parseAst)', () => {
  test('повертає ESTree Program з числовими start/end', () => {
    const ast = parseAst('const a = 1 + 2\n')
    expect(ast.type).toBe('Program')
    const decl = ast.body[0]
    expect(typeof decl.start).toBe('number')
    expect(typeof decl.end).toBe('number')
  })

  test('Literal має value і raw (контракт storybook-mutation)', () => {
    const ast = parseAst("const s = 'str'\n")
    let literal = null
    const walk = node => {
      if (!node || typeof node !== 'object') return
      if (node.type === 'Literal') literal = node
      for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v)
    }
    walk(ast)
    expect(literal?.value).toBe('str')
    expect(literal?.raw).toBe("'str'")
  })

  test('UnaryExpression має prefix і operator', () => {
    const ast = parseAst('const x = !y\n')
    let unary = null
    const walk = node => {
      if (!node || typeof node !== 'object') return
      if (node.type === 'UnaryExpression') unary = node
      for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v)
    }
    walk(ast)
    expect(unary?.operator).toBe('!')
    expect(unary?.prefix).toBe(true)
  })

  test('кидає на синтакс-помилці (throw-контракт rollup)', () => {
    expect(() => parseAst('const = broken(')).toThrow(PARSE_ERROR_RE)
  })

  test('приймає TS-діалект за filename', () => {
    const ast = parseAst('const a: number = 1\n', 'module.ts')
    expect(ast.body.length).toBe(1)
  })
})
