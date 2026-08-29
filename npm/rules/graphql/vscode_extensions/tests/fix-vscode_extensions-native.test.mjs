/**
 * Native-fix `graphql/vscode_extensions` (T5, §2.75) через ПРОДАКШН-шлях
 * `loadT0Patterns` → `nativeFixPattern` → `runNativeConcernFix` (napi).
 *
 * Окремий файл від `text/vscode_extensions` тому, що цей концерн (разом із
 * `tauri/vscode_extensions`) НЕ мав канонічного снапшота взагалі: список
 * розширень жив літералом лише у `.rego`, теки `template/` не існувало, тож
 * `snippetPath` спільного рушія (`npm/scripts/lib/fix/vscode-ext-add.mjs`)
 * не резолвився і фікс ЗАВЖДИ повертав `{ touchedFiles: [] }` — концерн
 * оголошений `"fixability": "config"`, лінт світив порушення, а `--fix`
 * мовчки не робив нічого. Полагоджено в джерелі: доданий
 * `template/extensions.json.snippet.json` із тим самим списком, що літерал у
 * `.rego`. Цей тест — гейт проти повернення того мовчазного no-op.
 */
import { describe, expect, test } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadT0Patterns } from '../../../../scripts/lib/lint-surface/run-fix.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

const CONCERN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const ruleId = 'graphql'
const concernId = 'vscode_extensions'
const TARGET = '.vscode/extensions.json'
const CANONICAL = 'graphql.vscode-graphql'

/** Порушення `policy-file-missing` — форма policy-адаптера для `required:single`. */
const missing = {
  reason: 'policy-file-missing',
  message: `${TARGET} не існує — додай рекомендовані розширення (graphql.mdc)`,
  file: TARGET,
  severity: 'error'
}

describe('native-fix graphql/vscode_extensions (колишній вічний no-op канону)', () => {
  test('снапшот у template/ збігається з літералом у .rego', () => {
    const snippet = JSON.parse(
      readFileSync(join(CONCERN_DIR, 'template/extensions.json.snippet.json'), 'utf8')
    )
    const rego = readFileSync(join(CONCERN_DIR, 'vscode_extensions.rego'), 'utf8')
    expect(snippet.recommendations).toEqual([CANONICAL])
    expect(rego).toContain(`"${CANONICAL}"`)
  })

  test('файлу немає — фікс реально створює його (раніше: порожній результат)', async () => {
    await withTmpDir(async dir => {
      const [pattern] = await loadT0Patterns(CONCERN_DIR, concernId, ruleId, dir)
      expect(pattern.id).toBe(`native-fix:${ruleId}/${concernId}`)
      expect(pattern.test([missing])).toBe(true)
      const res = await pattern.apply([missing], { cwd: dir, ruleId, concernId })
      expect(res.touchedFiles).toEqual([join(dir, TARGET)])
      expect(JSON.parse(readFileSync(res.touchedFiles[0], 'utf8')).recommendations).toEqual([
        CANONICAL
      ])
    })
  })

  test('чужі рекомендації не витісняються — лише union', async () => {
    await withTmpDir(async dir => {
      mkdirSync(join(dir, '.vscode'), { recursive: true })
      const abs = join(dir, TARGET)
      writeFileSync(abs, JSON.stringify({ recommendations: ['oxc.oxc-vscode'] }), 'utf8')
      const violation = { ...missing, reason: 'policy-deny' }
      const [pattern] = await loadT0Patterns(CONCERN_DIR, concernId, ruleId, dir)
      await pattern.apply([violation], { cwd: dir, ruleId, concernId })
      expect(JSON.parse(readFileSync(abs, 'utf8')).recommendations).toEqual([
        'oxc.oxc-vscode',
        CANONICAL
      ])
    })
  })
})
