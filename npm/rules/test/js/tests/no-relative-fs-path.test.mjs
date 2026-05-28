/**
 * Тести правила test.mdc (concern no-relative-fs-path): AST-сканер relative-path
 * аргументів у FS-функціях `node:fs`/`node:fs/promises` всередині `*.test.{js,mjs}`.
 */
import { describe, expect, test } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { check } from '../no-relative-fs-path.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

const HEAD = "import { writeFile, copyFile, mkdir } from 'node:fs/promises'\n"

describe('check test.no-relative-fs-path', () => {
  test('успіх: тест з join(dir, …) → exit 0', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/foo.test.mjs'),
        `${HEAD}await writeFile(join(dir, 'foo.json'), 'x', 'utf8')\n`
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test("порушення: writeFile('foo.json', …) → exit 1", async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/foo.test.mjs'),
        `${HEAD}await writeFile('foo.json', 'x', 'utf8')\n`
      )
      expect(await check(dir)).toBe(1)
    })
  })

  test("порушення: copyFile(src, 'foo.json') — 2-й аргумент relative → exit 1", async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/foo.test.mjs'),
        `${HEAD}await copyFile('/abs/src', 'foo.json')\n`
      )
      expect(await check(dir)).toBe(1)
    })
  })

  test('успіх: copyFile(absSrc, join(dir, dst)) → exit 0', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/foo.test.mjs'),
        `${HEAD}await copyFile('/abs/src', join(dir, 'dst'))\n`
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test('успіх: writeFile(absPath, …) з POSIX-абсолютним рядком → exit 0', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/foo.test.mjs'),
        `${HEAD}await writeFile('/tmp/x.json', 'x', 'utf8')\n`
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test('порушення: fsp.writeFile (MemberExpression) → exit 1', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/foo.test.mjs'),
        `import * as fsp from 'node:fs/promises'\nawait fsp.writeFile('foo', 'x')\n`
      )
      expect(await check(dir)).toBe(1)
    })
  })

  test('успіх: fs.writeFileSync(absPath, …) → exit 0', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/foo.test.mjs'),
        `import * as fs from 'node:fs'\nfs.writeFileSync('/tmp/x', 'y')\n`
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test('порушення: existsSync("foo.json") → exit 1', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/foo.test.mjs'),
        `import { existsSync } from 'node:fs'\nexistsSync('foo.json')\n`
      )
      expect(await check(dir)).toBe(1)
    })
  })

  test('успіх: rename(join(dir, src), join(dir, dst)) → exit 0', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/foo.test.mjs'),
        `${HEAD}await rename(join(dir, 'a'), join(dir, 'b'))\n`
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test('успіх: змінна-шлях (не string literal) — припускаємо absolute → exit 0', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/foo.test.mjs'),
        `${HEAD}const p = computeSomething()\nawait writeFile(p, 'x')\n`
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test('успіх: template literal з expression — НЕ statics, припускаємо OK → exit 0', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/foo.test.mjs'),
        `${HEAD}await writeFile(\`\${dir}/foo\`, 'x')\n`
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test('порушення: template literal без expression і relative — exit 1', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/foo.test.mjs'),
        `${HEAD}await writeFile(\`foo.json\`, 'x')\n`
      )
      expect(await check(dir)).toBe(1)
    })
  })

  test('не-тестові файли не скануються (production *.mjs з відносним writeFile OK)', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(
        join(dir, 'src/helper.mjs'),
        `${HEAD}export async function fn() { await writeFile('any.json', 'x') }\n`
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test('файл з syntax-error НЕ кидає, тільки пропускає аналіз', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(join(dir, 'tests/foo.test.mjs'), 'invalid <<<< syntax\n')
      expect(await check(dir)).toBe(0)
    })
  })

  test('обхід пропускає node_modules', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'node_modules/pkg/tests'), { recursive: true })
      await writeFile(
        join(dir, 'node_modules/pkg/tests/foo.test.mjs'),
        `${HEAD}await writeFile('any.json', 'x')\n`
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test('успіх: file:// URL → exit 0', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/foo.test.mjs'),
        `${HEAD}await writeFile('file:///abs/x', 'y')\n`
      )
      expect(await check(dir)).toBe(0)
    })
  })

  test("успіх: Windows-абсолютний 'C:\\\\foo' → exit 0", async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'tests'), { recursive: true })
      await writeFile(
        join(dir, 'tests/foo.test.mjs'),
        `${HEAD}await writeFile('C:\\\\foo\\\\bar', 'y')\n`
      )
      expect(await check(dir)).toBe(0)
    })
  })
})
