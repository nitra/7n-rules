/**
 * Тести generateDirIndex (реальна ФС, без моків):
 *   - згенерований index.md чистий за MD025/single-title (frontmatter `title:` —
 *     єдиний top-level заголовок; H1 у тілі прибрано — issue nitra/cursor#16);
 *   - чужий index.md (дока source-файлу або людський зміст) не перезаписується;
 *   - власний Directory Index перегенеровується.
 */
import { describe, expect, test } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { main as markdownlintCli2 } from 'markdownlint-cli2'

import { ensureDir, withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'
import { generateDirIndex } from '../main.mjs'

/** Дока source-файлу поряд з index.md — наповнення таблиці індексу. */
const FILE_DOC = `---
type: JS Module
title: foo.mjs
resource: src/foo.mjs
docgen:
  crc: deadbeef
---

## Огляд

Тестова дока.
`

/** H1-рядок у тілі markdown (module scope — без ре-компіляції). */
const BODY_H1_RE = /^# /mu

/**
 * Прогін markdownlint-cli2 (дефолтний конфіг) по одному файлу; повертає всі
 * лог-рядки — тест фільтрує їх на конкретне правило (MD025).
 * @param {string} dir корінь прогону
 * @param {string} relFile файл відносно dir
 * @returns {Promise<string>} зібраний лог markdownlint
 */
async function markdownlintLog(dir, relFile) {
  const lines = []
  const collect = s => {
    lines.push(String(s))
  }
  await markdownlintCli2({
    directory: dir,
    argv: [relFile],
    logMessage: collect,
    logError: collect
  })
  return lines.join('\n')
}

describe('generateDirIndex — MD025/single-title', () => {
  test('згенерований index.md без H1 у тілі; markdownlint не репортить MD025', async () => {
    await withTmpDir(async root => {
      const docsDir = join(root, 'src', 'docs')
      await ensureDir(docsDir)
      await writeFile(join(docsDir, 'foo.md'), FILE_DOC, 'utf8')

      generateDirIndex(docsDir, root)

      const index = await readFile(join(docsDir, 'index.md'), 'utf8')
      expect(index).toContain('type: Directory Index')
      expect(index).toContain('| [foo.mjs](foo.md) | JS Module |')
      // Жодного H1 у тілі — top-level заголовок лишається один (frontmatter title).
      const body = index.split('---').slice(2).join('---')
      expect(body).not.toMatch(BODY_H1_RE)
      expect(await markdownlintLog(root, 'src/docs/index.md')).not.toContain('MD025')
    })
  })

  test('контроль чутливості: frontmatter title + H1 у тілі → markdownlint репортить MD025', async () => {
    await withTmpDir(async root => {
      const docsDir = join(root, 'src', 'docs')
      await ensureDir(docsDir)
      // Старий шаблон індексу (з H1) — саме він валив MD025 у проєкті-споживачі.
      await writeFile(
        join(docsDir, 'index.md'),
        '---\ntype: Directory Index\ntitle: src\nresource: src/\n---\n\n# src\n\n| Файл | Тип |\n|---|---|\n| [foo.mjs](foo.md) | JS Module |\n',
        'utf8'
      )
      expect(await markdownlintLog(root, 'src/docs/index.md')).toContain('MD025')
    })
  })
})

describe('generateDirIndex — чужий index.md не перезаписується', () => {
  test('людський index.md без frontmatter лишається недоторканим', async () => {
    await withTmpDir(async root => {
      const docsDir = join(root, 'npm', 'docs')
      await ensureDir(docsDir)
      const human = '# Nitra MT — документація\n\nДив. [vision.md](vision.md).\n'
      await writeFile(join(docsDir, 'index.md'), human, 'utf8')
      await writeFile(join(docsDir, 'foo.md'), FILE_DOC, 'utf8')

      generateDirIndex(docsDir, root)
      expect(await readFile(join(docsDir, 'index.md'), 'utf8')).toBe(human)
    })
  })

  test('index.md як дока source-файлу (type JS Module) лишається недоторканою', async () => {
    await withTmpDir(async root => {
      const docsDir = join(root, 'src', 'docs')
      await ensureDir(docsDir)
      const sourceDoc = FILE_DOC.replace('resource: src/foo.mjs', 'resource: src/index.mjs')
      await writeFile(join(docsDir, 'index.md'), sourceDoc, 'utf8')
      await writeFile(join(docsDir, 'foo.md'), FILE_DOC, 'utf8')

      generateDirIndex(docsDir, root)
      expect(await readFile(join(docsDir, 'index.md'), 'utf8')).toBe(sourceDoc)
    })
  })

  test('власний Directory Index перегенеровується; без інших док index не створюється', async () => {
    await withTmpDir(async root => {
      const docsDir = join(root, 'src', 'docs')
      await ensureDir(docsDir)
      await writeFile(
        join(docsDir, 'index.md'),
        '---\ntype: Directory Index\ntitle: src\nresource: src/\n---\n\n| Файл | Тип |\n|---|---|\n| застарілий рядок |\n',
        'utf8'
      )
      await writeFile(join(docsDir, 'foo.md'), FILE_DOC, 'utf8')

      generateDirIndex(docsDir, root)
      const regenerated = await readFile(join(docsDir, 'index.md'), 'utf8')
      expect(regenerated).toContain('| [foo.mjs](foo.md) | JS Module |')
      expect(regenerated).not.toContain('застарілий рядок')

      const emptyDocs = join(root, 'empty', 'docs')
      await ensureDir(emptyDocs)
      generateDirIndex(emptyDocs, root)
      expect(existsSync(join(emptyDocs, 'index.md'))).toBe(false)
    })
  })
})
