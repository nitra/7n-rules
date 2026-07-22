/**
 * Тести smoke-покриття сторінок app-проєктів (storybook.mdc, ADR-розширення 2026-07-20,
 * хвиля 2a): кожен `.vue` під `src/pages/` app-пакета має мати хоча б один `*.stories.js`
 * поряд, рівень `warn`. Фікстури — динамічні тимчасові дерева (mkdtemp), як і решта
 * concern-ів storybook (авто-fix лінтера цього репо переписав би статичні "погані" зразки).
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { lint } from '../main.mjs'

/**
 * @param {string} root абсолютний шлях
 * @param {string} rel відносний шлях файлу
 * @param {string} content вміст
 */
async function writeFileDeep(root, rel, content) {
  const abs = join(root, rel)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, content, 'utf8')
}

/**
 * Створює мінімальний app-пакет у скоупі хвилі 2a (`vue` у dependencies, `.n-rules.json` →
 * `storybook.detectApps: true`).
 * @param {string} root корінь монорепо
 * @param {string} rootDir відносний корінь пакета
 */
async function writeVueAppPkg(root, rootDir) {
  await writeFileDeep(
    root,
    join(rootDir, 'package.json'),
    JSON.stringify({ name: `app-${rootDir}`, dependencies: { vue: '^3.6.0' } }, null, 2)
  )
  await writeFileDeep(root, join(rootDir, 'vite.config.js'), 'export default {}\n')
}

describe('page-coverage: smoke-покриття сторінок app-проєктів', () => {
  let root

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'storybook-page-coverage-'))
    await writeFileDeep(root, 'package.json', JSON.stringify({ name: 'root', workspaces: ['packages/*'] }, null, 2))
    await writeFileDeep(root, '.n-rules.json', JSON.stringify({ rules: [], storybook: { detectApps: true } }, null, 2))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('немає app-пакетів у скоупі — без порушень', async () => {
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/page-coverage' })
    expect(result.violations).toEqual([])
  })

  test('сторінка без story поряд — warn-порушення page-missing-story', async () => {
    await writeVueAppPkg(root, 'packages/gt')
    await writeFileDeep(root, 'packages/gt/src/pages/task/[id].vue', '<template><div/></template>\n')
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/page-coverage' })
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0].reason).toBe('page-missing-story')
    expect(result.violations[0].severity).toBe('warn')
    expect(result.violations[0].file).toBe('packages/gt/src/pages/task/[id].vue')
  })

  test('story поряд у тому самому каталозі (інший basename, як у прототипі gt) — без порушень', async () => {
    await writeVueAppPkg(root, 'packages/gt')
    await writeFileDeep(root, 'packages/gt/src/pages/task/[id].vue', '<template><div/></template>\n')
    await writeFileDeep(root, 'packages/gt/src/pages/task/task-detail.stories.js', 'export default {}\n')
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/page-coverage' })
    expect(result.violations).toEqual([])
  })

  test('кілька сторінок — репортує лише ту, що без story', async () => {
    await writeVueAppPkg(root, 'packages/gt')
    await writeFileDeep(root, 'packages/gt/src/pages/task/[id].vue', '<template><div/></template>\n')
    await writeFileDeep(root, 'packages/gt/src/pages/task/task-detail.stories.js', 'export default {}\n')
    await writeFileDeep(root, 'packages/gt/src/pages/Tasks.vue', '<template><div/></template>\n')
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/page-coverage' })
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0].file).toBe('packages/gt/src/pages/Tasks.vue')
  })

  test('бібліотечний пакет (type library) не потрапляє в перевірку page-coverage', async () => {
    await writeFileDeep(
      root,
      'packages/ui/package.json',
      JSON.stringify({ name: 'ui', peerDependencies: { vue: '^3.6.0' } }, null, 2)
    )
    for (let i = 0; i < 3; i++) {
      await writeFileDeep(root, `packages/ui/src/components/Comp${i}.vue`, '<template/>')
    }
    const result = await lint({ cwd: root, ruleId: 'storybook', concernId: 'storybook/page-coverage' })
    expect(result.violations).toEqual([])
  })
})
