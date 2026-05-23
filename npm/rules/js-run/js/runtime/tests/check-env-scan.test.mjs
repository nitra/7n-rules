/**
 * Модульні тести для AST-сканера правила «process.env / CheckEnv» (js-run.mdc).
 */
import { describe, expect, test } from 'bun:test'

import { findUncheckedProcessEnvInText, isCheckEnvScanSourceFile } from '../check-env-scan.mjs'

describe('check-env-scan: process.env завжди тригерить заміну на env', () => {
  test('process.env.X — порушення з kind=process-env', () => {
    const hits = findUncheckedProcessEnvInText(`console.log(process.env.PG_CONN)\n`, 'x.ts')
    expect(hits.length).toBe(1)
    expect(hits[0]).toEqual({ kind: 'process-env', name: 'PG_CONN', line: 1 })
  })

  test('process.env.X навіть із checkEnv лишається порушенням (треба замінити на env)', () => {
    const src = `import { checkEnv } from '@nitra/check-env'
checkEnv(['PG_CONN'])
console.log(process.env.PG_CONN)
`
    const hits = findUncheckedProcessEnvInText(src, 'x.ts')
    expect(hits.length).toBe(1)
    expect(hits[0].kind).toBe('process-env')
    expect(hits[0].name).toBe('PG_CONN')
  })

  test('process.env["X"] (computed string) теж ловиться як process-env', () => {
    const hits = findUncheckedProcessEnvInText(`const v = process.env['SECRET']\n`, 'x.ts')
    expect(hits.length).toBe(1)
    expect(hits[0]).toEqual({ kind: 'process-env', name: 'SECRET', line: 1 })
  })

  test('process.env[varName] (динамічний ключ) — пропускаємо без помилки', () => {
    const hits = findUncheckedProcessEnvInText(`const k = 'X'\nconst v = process.env[k]\n`, 'x.ts')
    expect(hits.length).toBe(0)
  })

  test('деструктуризація { X, Y } = process.env — кожне поле як process-env', () => {
    const hits = findUncheckedProcessEnvInText(`const { A, B } = process.env\n`, 'x.ts')
    expect(hits.map(h => `${h.kind}|${h.name}`).toSorted()).toEqual(['process-env|A', 'process-env|B'])
  })

  test('коментар-маркер на попередньому рядку приглушує і process.env', () => {
    const src = `// @nitra/cursor ignore-next-line checkEnv\nconsole.log(process.env.OPTIONAL)\n`
    expect(findUncheckedProcessEnvInText(src, 'x.ts').length).toBe(0)
  })
})

describe("check-env-scan: env з '@nitra/check-env' потребує checkEnv", () => {
  test("env.X без checkEnv після import { env } from '@nitra/check-env' — порушення", () => {
    const src = `import { env } from '@nitra/check-env'\nconsole.log(env.PG_CONN)\n`
    const hits = findUncheckedProcessEnvInText(src, 'x.ts')
    expect(hits.length).toBe(1)
    expect(hits[0]).toEqual({ kind: 'check-env-missing-checkEnv', name: 'PG_CONN', line: 2 })
  })

  test('env.X з checkEnv — без порушення', () => {
    const src = `import { checkEnv, env } from '@nitra/check-env'
checkEnv(['PG_CONN'])
console.log(env.PG_CONN)
`
    expect(findUncheckedProcessEnvInText(src, 'x.ts').length).toBe(0)
  })

  test('checkEnv після використання теж покриває (порядок не важливий)', () => {
    const src = `import { checkEnv, env } from '@nitra/check-env'\nconsole.log(env.PG_CONN)\ncheckEnv(['PG_CONN'])\n`
    expect(findUncheckedProcessEnvInText(src, 'x.ts').length).toBe(0)
  })

  test('частково покрита деструктуризація — лише непокрите поле fail', () => {
    const src = `import { checkEnv, env } from '@nitra/check-env'
checkEnv(['A'])
const { A, B } = env
`
    const hits = findUncheckedProcessEnvInText(src, 'x.ts')
    expect(hits.length).toBe(1)
    expect(hits[0]).toEqual({ kind: 'check-env-missing-checkEnv', name: 'B', line: 3 })
  })

  test('кілька checkEnv-викликів зливаються в один список', () => {
    const src = `import { checkEnv, env } from '@nitra/check-env'
checkEnv(['A'])
checkEnv(['B'])
const { A, B } = env
`
    expect(findUncheckedProcessEnvInText(src, 'x.ts').length).toBe(0)
  })

  test("env без імпорту з '@nitra/check-env' — не наша турбота", () => {
    const src = `import { env } from 'node:process'\nconsole.log(env.OPTIONAL)\n`
    expect(findUncheckedProcessEnvInText(src, 'x.ts').length).toBe(0)
  })

  test('локальний env без імпорту — не плутаємо з check-env', () => {
    const src = `function f(env) { return env.X }\n`
    expect(findUncheckedProcessEnvInText(src, 'x.ts').length).toBe(0)
  })

  test('коментар-маркер приглушує і env.X', () => {
    const src = `import { env } from '@nitra/check-env'
// @nitra/cursor ignore-next-line checkEnv
console.log(env.LEGACY)
`
    expect(findUncheckedProcessEnvInText(src, 'x.ts').length).toBe(0)
  })
})

describe('check-env-scan: інфраструктура', () => {
  test('isCheckEnvScanSourceFile фільтрує розширення', () => {
    expect(isCheckEnvScanSourceFile('src/a.ts')).toBe(true)
    expect(isCheckEnvScanSourceFile('src/a.mjs')).toBe(true)
    expect(isCheckEnvScanSourceFile('src/a.tsx')).toBe(true)
    expect(isCheckEnvScanSourceFile('src/a.json')).toBe(false)
    expect(isCheckEnvScanSourceFile('src/a.d.ts')).toBe(false)
  })

  test('синтаксична помилка → порожній результат', () => {
    expect(findUncheckedProcessEnvInText(`function (`, 'x.ts')).toEqual([])
  })
})
