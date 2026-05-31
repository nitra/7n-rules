/**
 * Тести для abie/lib/yaml.mjs: stripBom, isDeploymentDoc, silentFail, readAndParseYamlDocs.
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test, vi } from 'vitest'

import { LINE_SPLIT_RE, MODELINE_RE, isDeploymentDoc, readAndParseYamlDocs, silentFail, stripBom } from '../yaml.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

describe('stripBom', () => {
  test('прибирає BOM (U+FEFF) на початку рядка', () => {
    expect(stripBom('﻿apiVersion: v1')).toBe('apiVersion: v1')
  })

  test('рядок без BOM повертається без змін', () => {
    expect(stripBom('apiVersion: v1')).toBe('apiVersion: v1')
  })

  test('порожній рядок → порожній рядок', () => {
    expect(stripBom('')).toBe('')
  })
})

describe('LINE_SPLIT_RE', () => {
  test('розбиває LF', () => {
    expect('a\nb'.split(LINE_SPLIT_RE)).toEqual(['a', 'b'])
  })

  test('розбиває CRLF', () => {
    expect('a\r\nb'.split(LINE_SPLIT_RE)).toEqual(['a', 'b'])
  })
})

describe('MODELINE_RE', () => {
  test('зчитує $schema URL', () => {
    const m = '# yaml-language-server: $schema=https://example.com/schema.json'.match(MODELINE_RE)
    expect(m).not.toBeNull()
    expect(m?.[1]).toBe('https://example.com/schema.json')
  })

  test('не збігається з іншим коментарем', () => {
    expect(MODELINE_RE.test('# just a comment')).toBe(false)
  })
})

describe('isDeploymentDoc', () => {
  test('true для { kind: "Deployment" }', () => {
    expect(isDeploymentDoc({ kind: 'Deployment', apiVersion: 'apps/v1' })).toBe(true)
  })

  test('false для { kind: "Service" }', () => {
    expect(isDeploymentDoc({ kind: 'Service' })).toBe(false)
  })

  test('false для null', () => {
    expect(isDeploymentDoc(null)).toBe(false)
  })

  test('false для масиву', () => {
    expect(isDeploymentDoc([{ kind: 'Deployment' }])).toBe(false)
  })

  test('false для рядка', () => {
    expect(isDeploymentDoc('Deployment')).toBe(false)
  })
})

describe('silentFail', () => {
  test('нічого не кидає і не повертає значення', () => {
    expect(() => silentFail('some error')).not.toThrow()
    expect(silentFail('x')).toBeUndefined()
  })
})

describe('readAndParseYamlDocs', () => {
  test('читає і парсить валідний YAML', async () => {
    await withTmpDir(async dir => {
      const abs = join(dir, 'test.yaml')
      await writeFile(abs, 'kind: Deployment\napiVersion: apps/v1\n', 'utf8')
      const failFn = vi.fn()
      const docs = await readAndParseYamlDocs(abs, 'test.yaml', failFn)
      expect(docs).not.toBeNull()
      expect(docs?.length).toBeGreaterThanOrEqual(1)
      expect(failFn).not.toHaveBeenCalled()
    })
  })

  test('видаляє modeline перед парсингом', async () => {
    await withTmpDir(async dir => {
      const abs = join(dir, 'with-modeline.yaml')
      await writeFile(abs, '# yaml-language-server: $schema=https://example.com/s.json\nkind: Service\n', 'utf8')
      const failFn = vi.fn()
      const docs = await readAndParseYamlDocs(abs, 'with-modeline.yaml', failFn)
      expect(docs).not.toBeNull()
      expect(failFn).not.toHaveBeenCalled()
    })
  })

  test('видаляє BOM перед парсингом', async () => {
    await withTmpDir(async dir => {
      const abs = join(dir, 'bom.yaml')
      await writeFile(abs, '﻿kind: Deployment\n', 'utf8')
      const failFn = vi.fn()
      const docs = await readAndParseYamlDocs(abs, 'bom.yaml', failFn)
      expect(docs).not.toBeNull()
      expect(failFn).not.toHaveBeenCalled()
    })
  })

  test('викликає failFn і повертає null якщо файл не існує', async () => {
    const failFn = vi.fn()
    const docs = await readAndParseYamlDocs('/nonexistent/path.yaml', 'path.yaml', failFn)
    expect(docs).toBeNull()
    expect(failFn).toHaveBeenCalledOnce()
  })
})
