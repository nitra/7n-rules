/**
 * Тести T0-фіксера `python.doc_comments` (`fix-doc_comments.mjs` — лишається
 * JS-каноном, на відміну від детектора: `Guest::fix` гостя
 * `crates/plugin-lang-python` для цього концерну свідомо віддає порожній план).
 *
 * Виділені з `doc_comments.test.mjs` при знятті JS-детектора: той файл імпортував
 * `checkFileDocComments` з видаленого `main.mjs` і будував вхід фіксера з нього.
 * Тепер `violations` задані ЛІТЕРАЛЬНО — і це не спрощення, а точніше дзеркало
 * продакшену: у робочому конвеєрі вхід фіксера дає wasm-гість, не JS-детектор.
 * Значення `data` (`fromLine`/`toLine`/`headerEnd`/`name`) зняті з фактичного
 * виводу `runWasmConcern(plugin_lang_python.wasm, 'python/doc_comments', …)` на
 * цій самій фікстурі — не вигадані.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { buildDocstring, patterns } from '../fix-doc_comments.mjs'

// Фікстури зібрані динамічно: потрійні лапки складаються з частин, щоб файл
// не плутав парсери/лінтери власним умістом.
const tq = '"'.repeat(3)
const docstring = text => `${tq}${text}${tq}`
const hash = text => `# ${text}`

describe('fix python.doc_comments — T0 # → docstring', () => {
  test('buildDocstring: один рядок і багаторядковий', () => {
    expect(buildDocstring(['робить X'], ' '.repeat(4))).toEqual([`    ${docstring('робить X')}`])
    expect(buildDocstring(['перший', 'другий'], '  ')).toEqual([`  ${tq}перший`, '  другий', `  ${tq}`])
  })

  test('apply: #-блок стає docstring-ом на місці def', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'py-doc-'))
    try {
      // Рядки: 0 — module-docstring, 1 — порожній, 2 — `# робить X`,
      // 3 — `def go():` (звідси headerEnd), 4 — тіло.
      const src = [docstring('М.'), '', hash('робить X'), 'def go():', '    return 1', ''].join('\n')
      writeFileSync(join(dir, 'a.py'), src)

      const violations = [
        {
          reason: 'missing-def-docstring',
          message: 'a.py: def go без docstring.',
          file: 'a.py',
          severity: 'error',
          data: { promotable: true, fromLine: 2, toLine: 2, headerEnd: 3, name: 'go' }
        }
      ]
      expect(patterns[0].test(violations)).toBe(true)

      const writes = []
      await patterns[0].apply(violations, {
        cwd: dir,
        recordWrite: p => {
          writes.push(p)
        }
      })

      const after = readFileSync(join(dir, 'a.py'), 'utf8')
      expect(writes).toHaveLength(1)
      expect(after).toContain(`    ${docstring('робить X')}`)
      expect(after).not.toContain(hash('робить X'))
      // Порядок рядків: docstring став ПЕРШИМ рядком тіла, `#`-блок зник.
      expect(after.split('\n')).toEqual([docstring('М.'), '', 'def go():', `    ${docstring('робить X')}`, '    return 1', ''])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
