/**
 * Тести допоміжних функцій rules/nginx-default-tpl/fix.mjs (HTTPRoute, ini, шаблон).
 */
import { describe, expect, test } from 'vitest'
import { existsSync } from 'node:fs'
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  check,
  findDefaultConfTemplatePaths,
  httpRouteMatchesNginxDefaultTpl,
  iniKeysMissingInTemplate,
  migrateDefaultTplConfFiles,
  nginxTemplateViolations,
  parseIniVariableNames
} from '../../../template.mjs'
import { ensureDir, withTmpDir } from '../../../../../../scripts/utils/test-helpers.mjs'

const fixDir = join(fileURLToPath(new URL('.', import.meta.url)), '../fixtures')

describe('parseIniVariableNames / iniKeysMissingInTemplate', () => {
  test('парсить ключі та вимагає $KEY у шаблоні', () => {
    expect(parseIniVariableNames('PUBLIC_PATH=/x\n# c\n\nFOO=1')).toEqual(['PUBLIC_PATH', 'FOO'])
    expect(iniKeysMissingInTemplate(['PUBLIC_PATH'], 'prefix $PUBLIC_PATH/suffix')).toBeNull()
    expect(iniKeysMissingInTemplate(['ORPHAN'], 'no placeholder')).toContain('ORPHAN')
  })
})

describe('migrateDefaultTplConfFiles', () => {
  test('перейменовує default.tpl.conf у дереві на default.conf.template', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'nginx'))
      const oldPath = join(dir, 'nginx/default.tpl.conf')
      const newPath = join(dir, 'nginx/default.conf.template')
      await writeFile(oldPath, 'server_tokens off;\n', 'utf8')
      const { renamed, overwritten } = await migrateDefaultTplConfFiles(dir)
      expect(overwritten).toEqual([])
      expect(renamed).toEqual(['nginx/default.tpl.conf'])
      expect(existsSync(newPath)).toBe(true)
      expect(existsSync(oldPath)).toBe(false)
    })
  })

  test('перезаписує default.conf.template вмістом default.tpl.conf, якщо обидва є', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'd'))
      await writeFile(join(dir, 'd/default.tpl.conf'), 'from-tpl', 'utf8')
      await writeFile(join(dir, 'd/default.conf.template'), 'old-template', 'utf8')
      const { renamed, overwritten } = await migrateDefaultTplConfFiles(dir)
      expect(renamed).toEqual([])
      expect(overwritten).toEqual(['d/default.tpl.conf'])
      expect(existsSync(join(dir, 'd/default.tpl.conf'))).toBe(false)
      expect(await readFile(join(dir, 'd/default.conf.template'), 'utf8')).toBe('from-tpl')
    })
  })
})

describe('findDefaultConfTemplatePaths', () => {
  test('не включає tests/fixtures', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'tests/fixtures/nginx'))
      await copyFile(join(fixDir, 'default.conf.template'), join(dir, 'tests/fixtures/nginx/default.conf.template'))
      await ensureDir(join(dir, 'app/nginx'))
      await writeFile(join(dir, 'app/nginx/default.conf.template'), 'server_tokens off;\n', 'utf8')
      const paths = await findDefaultConfTemplatePaths(dir)
      expect(paths).toHaveLength(1)
      expect(paths[0].replaceAll('\\', '/')).toContain('app/nginx/default.conf.template')
    })
  })
})

describe('nginxTemplateViolations', () => {
  test('null для канонічного зразка з каталогу fixtures', async () => {
    const tpl = await readFile(join(fixDir, 'default.conf.template'), 'utf8')
    expect(nginxTemplateViolations(tpl)).toBeNull()
  })

  test('помилка при proxy_pass', async () => {
    const base = await readFile(join(fixDir, 'default.conf.template'), 'utf8')
    const bad = `${base}\n    proxy_pass http://backend;\n`
    expect(nginxTemplateViolations(bad)).toContain('proxy')
  })
})

describe('httpRouteMatchesNginxDefaultTpl', () => {
  test('true для маніфесту з прикладу в правилі', () => {
    const route = {
      kind: 'HTTPRoute',
      spec: {
        rules: [
          {
            matches: [{ path: { type: 'Exact', value: '/app' } }],
            filters: [
              {
                type: 'RequestRedirect',
                requestRedirect: {
                  scheme: 'https',
                  path: { type: 'ReplaceFullPath', replaceFullPath: '/app/' },
                  statusCode: 301
                }
              }
            ]
          },
          {
            matches: [{ path: { type: 'PathPrefix', value: '/app/' } }],
            backendRefs: [{ name: 'frontend', port: 8080 }]
          }
        ]
      }
    }
    expect(httpRouteMatchesNginxDefaultTpl(route)).toBe(true)
  })

  test('false без другого правила', () => {
    expect(
      httpRouteMatchesNginxDefaultTpl({
        kind: 'HTTPRoute',
        spec: { rules: [{ matches: [{ path: { type: 'Exact', value: '/' } }], filters: [] }] }
      })
    ).toBe(false)
  })

  test('false для null → line 185', () => {
    expect(httpRouteMatchesNginxDefaultTpl(null)).toBe(false)
    expect(httpRouteMatchesNginxDefaultTpl(undefined)).toBe(false)
    expect(httpRouteMatchesNginxDefaultTpl([])).toBe(false)
    expect(httpRouteMatchesNginxDefaultTpl('string')).toBe(false)
  })
})

describe('check()', () => {
  test('template з порушенням (proxy_pass) → fail, line 296', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'nginx'))
      const base = await readFile(join(fixDir, 'default.conf.template'), 'utf8')
      await writeFile(join(dir, 'nginx/default.conf.template'), `${base}\n    proxy_pass http://backend;\n`, 'utf8')
      await writeFile(join(dir, 'nginx/values-dev.ini'), 'ENV=dev\n', 'utf8')
      const code = await check(dir)
      expect(code).toBe(1)
    })
  })

  test('default.tpl.conf мігрується → pass на line 413', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'nginx'))
      const base = await readFile(join(fixDir, 'default.conf.template'), 'utf8')
      await writeFile(join(dir, 'nginx/default.tpl.conf'), base, 'utf8')
      await writeFile(join(dir, 'nginx/values-dev.ini'), 'ENV=dev\n', 'utf8')
      const code = await check(dir)
      expect(code).toBe(1)
    })
  })

  test('default.tpl.conf + default.conf.template → перезапис, line 416', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'nginx'))
      const base = await readFile(join(fixDir, 'default.conf.template'), 'utf8')
      await writeFile(join(dir, 'nginx/default.tpl.conf'), base, 'utf8')
      await writeFile(join(dir, 'nginx/default.conf.template'), 'old content', 'utf8')
      await writeFile(join(dir, 'nginx/values-dev.ini'), 'ENV=dev\n', 'utf8')
      const code = await check(dir)
      expect(code).toBe(1)
    })
  })
})
