/**
 * Тести допоміжних функцій check-nginx-default-tpl.mjs (HTTPRoute, ini, шаблон).
 */
import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  findDefaultConfTemplatePaths,
  httpRouteMatchesNginxDefaultTpl,
  iniKeysMissingInTemplate,
  migrateDefaultTplConfFiles,
  nginxTemplateViolations,
  parseIniVariableNames
} from './check.mjs'
import { ensureDir, withTmpCwd } from '../../../scripts/utils/test-helpers.mjs'

const fixDir = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures')

describe('parseIniVariableNames / iniKeysMissingInTemplate', () => {
  test('парсить ключі та вимагає $KEY у шаблоні', () => {
    expect(parseIniVariableNames('PUBLIC_PATH=/x\n# c\n\nFOO=1')).toEqual(['PUBLIC_PATH', 'FOO'])
    expect(iniKeysMissingInTemplate(['PUBLIC_PATH'], 'prefix $PUBLIC_PATH/suffix')).toBeNull()
    expect(iniKeysMissingInTemplate(['ORPHAN'], 'no placeholder')).toContain('ORPHAN')
  })
})

describe('migrateDefaultTplConfFiles', () => {
  test('перейменовує default.tpl.conf у дереві на default.conf.template', async () => {
    await withTmpCwd(async () => {
      await ensureDir('nginx')
      const oldPath = join(process.cwd(), 'nginx/default.tpl.conf')
      const newPath = join(process.cwd(), 'nginx/default.conf.template')
      await writeFile(oldPath, 'server_tokens off;\n', 'utf8')
      const { renamed, overwritten } = await migrateDefaultTplConfFiles(process.cwd())
      expect(overwritten).toEqual([])
      expect(renamed).toEqual(['nginx/default.tpl.conf'])
      expect(existsSync(newPath)).toBe(true)
      expect(existsSync(oldPath)).toBe(false)
    })
  })

  test('перезаписує default.conf.template вмістом default.tpl.conf, якщо обидва є', async () => {
    await withTmpCwd(async () => {
      await ensureDir('d')
      await writeFile(join('d/default.tpl.conf'), 'from-tpl', 'utf8')
      await writeFile(join('d/default.conf.template'), 'old-template', 'utf8')
      const { renamed, overwritten } = await migrateDefaultTplConfFiles(process.cwd())
      expect(renamed).toEqual([])
      expect(overwritten).toEqual(['d/default.tpl.conf'])
      expect(existsSync(join(process.cwd(), 'd/default.tpl.conf'))).toBe(false)
      expect(await readFile(join('d/default.conf.template'), 'utf8')).toBe('from-tpl')
    })
  })
})

describe('findDefaultConfTemplatePaths', () => {
  test('не включає tests/fixtures', async () => {
    await withTmpCwd(async () => {
      await ensureDir('tests/fixtures/nginx')
      await copyFile(join(fixDir, 'default.conf.template'), join('tests/fixtures/nginx/default.conf.template'))
      await ensureDir('app/nginx')
      await writeFile(join('app/nginx/default.conf.template'), 'server_tokens off;\n', 'utf8')
      const paths = await findDefaultConfTemplatePaths(process.cwd())
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
})
