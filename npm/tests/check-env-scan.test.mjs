/**
 * Модульні тести для AST-сканера правила «CheckEnv» (js-run.mdc).
 */
import { describe, expect, test } from 'bun:test'

import { findUncheckedProcessEnvInText, isCheckEnvScanSourceFile } from '../scripts/utils/check-env-scan.mjs'

describe('check-env-scan', () => {
  test('process.env.X без checkEnv — порушення', () => {
    const hits = findUncheckedProcessEnvInText(`console.log(process.env.PG_CONN)\n`, 'x.ts')
    expect(hits.length).toBe(1)
    expect(hits[0].name).toBe('PG_CONN')
    expect(hits[0].line).toBe(1)
  })

  test('process.env.X закрите checkEnv(["X"]) у файлі — без порушення', () => {
    const src =
      `import { checkEnv } from '@nitra/check-env'\n` +
      `checkEnv(['PG_CONN'])\n` +
      `console.log(process.env.PG_CONN)\n`
    expect(findUncheckedProcessEnvInText(src, 'x.ts').length).toBe(0)
  })

  test('checkEnv після використання теж покриває (по файлу)', () => {
    const src = `console.log(process.env.PG_CONN)\ncheckEnv(['PG_CONN'])\n`
    expect(findUncheckedProcessEnvInText(src, 'x.ts').length).toBe(0)
  })

  test('коментар-маркер на попередньому рядку — без порушення', () => {
    const src = `// @nitra/cursor ignore-next-line checkEnv\nconsole.log(process.env.OPTIONAL_ENV_VAR)\n`
    expect(findUncheckedProcessEnvInText(src, 'x.ts').length).toBe(0)
  })

  test('коментар-маркер з різним пробілом теж працює', () => {
    const src = `//   @nitra/cursor   ignore-next-line   checkEnv\nlet v = process.env.X\n`
    expect(findUncheckedProcessEnvInText(src, 'x.ts').length).toBe(0)
  })

  test('process.env["X"] (computed string) теж ловиться', () => {
    const hits = findUncheckedProcessEnvInText(`const v = process.env['SECRET']\n`, 'x.ts')
    expect(hits.length).toBe(1)
    expect(hits[0].name).toBe('SECRET')
  })

  test('process.env[varName] (динамічний ключ) — пропускаємо без помилки', () => {
    const hits = findUncheckedProcessEnvInText(`const k = 'X'\nconst v = process.env[k]\n`, 'x.ts')
    expect(hits.length).toBe(0)
  })

  test('деструктуризація { X, Y } = process.env — кожне поле перевіряється', () => {
    const hits = findUncheckedProcessEnvInText(`const { A, B } = process.env\n`, 'x.ts')
    expect(hits.map(h => h.name).sort()).toEqual(['A', 'B'])
  })

  test('деструктуризація з checkEnv покрита', () => {
    const src = `checkEnv(['A','B'])\nconst { A, B } = process.env\n`
    expect(findUncheckedProcessEnvInText(src, 'x.ts').length).toBe(0)
  })

  test('частково покрита деструктуризація — лише непокрите поле fail', () => {
    const src = `checkEnv(['A'])\nconst { A, B } = process.env\n`
    const hits = findUncheckedProcessEnvInText(src, 'x.ts')
    expect(hits.length).toBe(1)
    expect(hits[0].name).toBe('B')
  })

  test('кілька checkEnv-викликів зливаються в один список', () => {
    const src = `checkEnv(['A'])\ncheckEnv(['B'])\nconst { A, B } = process.env\n`
    expect(findUncheckedProcessEnvInText(src, 'x.ts').length).toBe(0)
  })

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
