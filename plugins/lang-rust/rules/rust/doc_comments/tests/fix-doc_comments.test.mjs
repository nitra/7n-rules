/**
 * Тести T0-фіксера `rust.doc_comments` (`fix-doc_comments.mjs` — лишається
 * JS-каноном: `Guest::fix` гостя `crates/plugin-lang-rust` для цього концерну
 * свідомо віддає порожній план).
 *
 * Виділені з `doc_comments.test.mjs` при знятті JS-детектора: той файл
 * імпортував `checkFileDocComments` із видаленого `main.mjs` і будував вхід
 * фіксера з нього. Тепер `violations` задані ЛІТЕРАЛЬНО — і це точніше
 * дзеркало продакшену, де вхід фіксеру дає wasm-гість, а не JS-детектор.
 * Значення `data` (`fromLine`/`toLine`/`header`/`name`) зняті з фактичного
 * виводу `runWasmConcern(plugin_lang_rust.wasm, 'rust/doc_comments', …)` на
 * цій самій фікстурі — не вигадані.
 *
 * Властивість «після `apply` детектор мовчить» переїхала у parity-гейт
 * (`npm/scripts/lib/lint-surface/tests/wasm-plugin-parity-rust.test.mjs`),
 * де гість уже завантажений — тут її відтворити нічим.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { patterns, promoteBlock } from '../fix-doc_comments.mjs'

describe('fix rust.doc_comments — T0 підвищення', () => {
  test('promoteBlock: // → /// і // → //! зі збереженням відступу', () => {
    const lines = ['  // текст', '// намір']
    promoteBlock(lines, { fromLine: 0, toLine: 0 })
    promoteBlock(lines, { fromLine: 1, toLine: 1, header: true })
    expect(lines).toEqual(['  /// текст', '//! намір'])
  })

  test('apply: обидва блоки підвищено — заголовок файлу і опис pub-елемента', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rust-doc-'))
    try {
      // Рядки: 0 — `// намір файлу` (header-блок), 1 — порожній,
      // 2 — `// робить X`, 3 — `pub fn go() {}`.
      const src = ['// намір файлу', '', '// робить X', 'pub fn go() {}', ''].join('\n')
      mkdirSync(join(dir, 'src'), { recursive: true })
      writeFileSync(join(dir, 'src/a.rs'), src)

      const violations = [
        {
          reason: 'missing-file-header',
          message: 'src/a.rs: файл із pub-елементами без провідного //!-коментаря.',
          file: 'src/a.rs',
          severity: 'error',
          data: { promotable: true, fromLine: 0, toLine: 0, header: true }
        },
        {
          reason: 'missing-pub-doc',
          message: 'src/a.rs: pub fn go без ///-опису.',
          file: 'src/a.rs',
          severity: 'error',
          data: { promotable: true, fromLine: 2, toLine: 2, name: 'go' }
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

      const after = readFileSync(join(dir, 'src/a.rs'), 'utf8')
      expect(writes).toHaveLength(1)
      expect(after.split('\n')).toEqual(['//! намір файлу', '', '/// робить X', 'pub fn go() {}', ''])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
