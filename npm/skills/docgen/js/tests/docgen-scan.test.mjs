import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

import { withTmpDir, ensureDir } from '../../../../scripts/utils/test-helpers.mjs'
import {
  isSourceFile,
  docPathForSource,
  scanForDocgen,
  scanForModules,
  runDocgenScanCli,
  runDocgenModulesCli
} from '../docgen-scan.mjs'
import { DOCGEN_IGNORE_GLOBS, isDocgenIgnored } from '../docgen-ignore.mjs'

describe('isSourceFile', () => {
  test('документує .js/.mjs/.ts/.vue/.py', () => {
    expect(isSourceFile('foo.js')).toBe(true)
    expect(isSourceFile('foo.mjs')).toBe(true)
    expect(isSourceFile('foo.ts')).toBe(true)
    expect(isSourceFile('Foo.vue')).toBe(true)
    expect(isSourceFile('foo.py')).toBe(true)
  })

  test('пропускає .d.ts (типи без логіки)', () => {
    expect(isSourceFile('types.d.ts')).toBe(false)
  })

  test('пропускає *.test.* і *.spec.*', () => {
    expect(isSourceFile('foo.test.js')).toBe(false)
    expect(isSourceFile('foo.spec.ts')).toBe(false)
  })

  test('пропускає некодові розширення (.md/.json/.txt)', () => {
    expect(isSourceFile('README.md')).toBe(false)
    expect(isSourceFile('package.json')).toBe(false)
    expect(isSourceFile('notes.txt')).toBe(false)
  })
})

describe('docPathForSource', () => {
  test('кладе docs/<stem>.md поряд із джерелом', () => {
    expect(docPathForSource(join('src', 'lib', 'foo.js'))).toBe(join('src', 'lib', 'docs', 'foo.md'))
  })

  test('зберігає stem для будь-якого кодового розширення', () => {
    expect(docPathForSource(join('a', 'b', 'comp.vue'))).toBe(join('a', 'b', 'docs', 'comp.md'))
    expect(docPathForSource('root.mjs')).toBe(join('docs', 'root.md'))
  })
})

describe('scanForDocgen', () => {
  test('знаходить кодові файли всередині дерева і пропускає root-level файли', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'docs', 'adr'))
      await ensureDir(join(root, 'src'))
      await writeFile(join(root, 'src', 'a.js'), 'export const a = 1\n')
      await writeFile(join(root, 'b.ts'), 'export const b = 2\n')

      const items = await scanForDocgen(root)
      const a = items.find(i => i.sourcePath === join('src', 'a.js'))
      expect(a.sourcePath).toBe(join('src', 'a.js'))
      expect(a.docPath).toBe(join('src', 'docs', 'a.md'))
      expect(a.exists).toBe(false)
      expect(a).not.toHaveProperty('relSource')
      expect(items.map(i => i.sourcePath).toSorted()).toEqual([join('src', 'a.js')])
    })
  })

  test('ігнорує службові дерева за glob-ами', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, '.pi', 'extensions'))
      await ensureDir(join(root, '.pi-template'))
      await ensureDir(join(root, 'benchmarks', 'demo', 'src'))
      await ensureDir(join(root, 'demo', 'src'))
      await ensureDir(join(root, 'src'))
      await writeFile(join(root, '.pi', 'extensions', 'x.ts'), 'export default 1\n')
      await writeFile(join(root, '.pi-template', 'y.js'), 'export default 1\n')
      await writeFile(join(root, 'benchmarks', 'demo', 'src', 'z.mjs'), 'export default 1\n')
      await writeFile(join(root, 'demo', 'src', 'main.js'), 'export default 1\n')
      await writeFile(join(root, 'src', 'keep.js'), 'export default 1\n')

      const items = await scanForDocgen(root)
      expect(items.map(i => i.sourcePath)).toEqual(['src/keep.js'])
    })
  })

  test('ігнорує node_modules/dist/.git', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'node_modules', 'pkg'))
      await ensureDir(join(root, 'dist'))
      await writeFile(join(root, 'node_modules', 'pkg', 'x.js'), 'noop\n')
      await writeFile(join(root, 'dist', 'bundle.js'), 'noop\n')
      await writeFile(join(root, 'index.js'), 'export default 1\n')

      const items = await scanForDocgen(root)
      expect(items.map(i => i.sourcePath)).toEqual(['index.js'])
    })
  })

  test('ігнорує теки docs/ (згенерована дока не ресканиться)', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'docs'))
      await writeFile(join(root, 'docs', 'fake.js'), 'noop\n')
      await writeFile(join(root, 'real.js'), 'export default 1\n')

      const items = await scanForDocgen(root)
      expect(items.map(i => i.sourcePath)).toEqual(['real.js'])
    })
  })

  test('ставить exists=true, коли дока файлу вже є', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'docs'))
      await writeFile(join(root, 'foo.js'), 'export default 1\n')
      await writeFile(join(root, 'docs', 'foo.md'), '# є\n')

      const items = await scanForDocgen(root)
      expect(items[0].sourcePath).toBe('foo.js')
      expect(items[0].exists).toBe(true)
    })
  })
})

describe('docgen ignore globs', () => {
  test('має окремий список glob-ів для службових дерев', () => {
    expect(DOCGEN_IGNORE_GLOBS).toContain('.pi/**')
    expect(DOCGEN_IGNORE_GLOBS).toContain('.pi-template/**')
    expect(DOCGEN_IGNORE_GLOBS).toContain('**/benchmarks/**')
    expect(DOCGEN_IGNORE_GLOBS).toContain('**/demo/**')
  })

  test('розпізнає ignored path і dir через один helper', () => {
    expect(isDocgenIgnored('.pi/extensions/x.ts')).toBe(true)
    expect(isDocgenIgnored('benchmarks/demo/src/z.mjs')).toBe(true)
    expect(isDocgenIgnored('demo/src/main.js')).toBe(true)
    expect(isDocgenIgnored('demo', 'dir')).toBe(true)
    expect(isDocgenIgnored('src/keep.js')).toBe(false)
    expect(isDocgenIgnored('src', 'dir')).toBe(false)
  })
})

describe('runDocgenScanCli', () => {
  test('друкує JSON-масив файлів і повертає 0', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'docs', 'adr'))
      await writeFile(join(root, 'foo.js'), 'export const a = 1\n')

      const lines = []
      const orig = console.log
      console.log = msg => lines.push(msg)
      let code
      try {
        code = await runDocgenScanCli(['--root', root])
      } finally {
        console.log = orig
      }

      expect(code).toBe(0)
      expect(lines).toHaveLength(1)
      const parsed = JSON.parse(lines[0])
      expect(Array.isArray(parsed)).toBe(true)
      expect(parsed).toEqual([])
    })
  })

  test('повертає 1, коли --root не існує', async () => {
    const errs = []
    const origErr = console.error
    console.error = msg => errs.push(msg)
    let code
    try {
      code = await runDocgenScanCli(['--root', join('/no', 'such', 'dir', 'xyz123')])
    } finally {
      console.error = origErr
    }
    expect(code).toBe(1)
    expect(errs.join('\n')).toContain('не існує')
  })

  test('повертає 1, коли --root — файл, а не директорія', async () => {
    await withTmpDir(async root => {
      const file = join(root, 'file.js')
      await writeFile(file, 'export default 1\n')

      const errs = []
      const origErr = console.error
      console.error = msg => errs.push(msg)
      let code
      try {
        code = await runDocgenScanCli(['--root', file])
      } finally {
        console.error = origErr
      }
      expect(code).toBe(1)
    })
  })
})

describe('scanForModules', () => {
  test('призначає файл найближчому модулю-предку за package.json', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'docs', 'adr'))
      await ensureDir(join(root, 'npm', 'rules', 'adr'))
      await writeFile(join(root, 'package.json'), '{"name":"root"}\n')
      await writeFile(join(root, 'npm', 'rules', 'adr', 'package.json'), '{"name":"adr"}\n')
      await writeFile(join(root, 'npm', 'rules', 'adr', 'index.mjs'), 'export const a = 1\n')
      await ensureDir(join(root, 'src'))
      await writeFile(join(root, 'src', 'app.js'), 'export const b = 2\n')
      await writeFile(join(root, 'app.js'), 'export const skip = 1\n')

      const mods = await scanForModules(root)
      const adr = mods.find(m => m.relRoot === join('npm', 'rules', 'adr'))
      const rootMod = mods.find(m => m.relRoot === '.')

      expect(adr.slug).toBe('npm-rules-adr')
      expect(adr.moduleRoot).toBe(join(root, 'npm', 'rules', 'adr'))
      expect(adr.docPath).toBe(join(root, 'npm', 'rules', 'adr', 'docs', 'ARCHITECTURE.md'))
      expect(adr.members).toEqual([join('npm', 'rules', 'adr', 'index.mjs')])
      expect(rootMod.members).toEqual([join('src', 'app.js')])
      expect(rootMod.slug).toBe('root')
    })
  })

  test('пропускає модулі без кодових файлів', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'empty'))
      await writeFile(join(root, 'package.json'), '{"name":"root"}\n')
      await writeFile(join(root, 'empty', 'package.json'), '{"name":"empty"}\n')
      await writeFile(join(root, 'index.ts'), 'export default 1\n')

      const mods = await scanForModules(root)
      expect(mods.map(m => m.relRoot)).toEqual(['.'])
    })
  })

  test('ігнорує package.json усередині node_modules', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'node_modules', 'pkg'))
      await writeFile(join(root, 'package.json'), '{"name":"root"}\n')
      await writeFile(join(root, 'node_modules', 'pkg', 'package.json'), '{"name":"pkg"}\n')
      await writeFile(join(root, 'node_modules', 'pkg', 'x.js'), 'noop\n')
      await writeFile(join(root, 'index.ts'), 'export default 1\n')

      const mods = await scanForModules(root)
      expect(mods.map(m => m.relRoot)).toEqual(['.'])
    })
  })

  test('ставить exists=true, коли ARCHITECTURE.md уже є', async () => {
    await withTmpDir(async root => {
      await ensureDir(join(root, 'docs'))
      await writeFile(join(root, 'package.json'), '{"name":"root"}\n')
      await writeFile(join(root, 'index.ts'), 'export default 1\n')
      await writeFile(join(root, 'docs', 'ARCHITECTURE.md'), '# є\n')

      const mods = await scanForModules(root)
      expect(mods[0].exists).toBe(true)
    })
  })
})

describe('runDocgenModulesCli', () => {
  test('друкує JSON-масив модулів і повертає 0', async () => {
    await withTmpDir(async root => {
      await writeFile(join(root, 'package.json'), '{"name":"root"}\n')
      await writeFile(join(root, 'foo.js'), 'export const a = 1\n')

      const lines = []
      const orig = console.log
      console.log = msg => lines.push(msg)
      let code
      try {
        code = await runDocgenModulesCli(['--root', root])
      } finally {
        console.log = orig
      }

      expect(code).toBe(0)
      expect(lines).toHaveLength(1)
      const parsed = JSON.parse(lines[0])
      expect(Array.isArray(parsed)).toBe(true)
      expect(parsed[0].slug).toBe('root')
      expect(parsed[0].members).toEqual(['foo.js'])
    })
  })

  test('повертає 1, коли --root не існує', async () => {
    const errs = []
    const origErr = console.error
    console.error = msg => errs.push(msg)
    let code
    try {
      code = await runDocgenModulesCli(['--root', join('/no', 'such', 'dir', 'xyz123')])
    } finally {
      console.error = origErr
    }
    expect(code).toBe(1)
    expect(errs.join('\n')).toContain('не існує')
  })
})
