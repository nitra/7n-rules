/**
 * Тести детекції Storybook-workspace-ів (storybook.mjs): isStorybookRoot — канонічна
 * детекція за Storybook-identity devDeps (`STORYBOOK_CANON_DEV_DEPS`) у
 * `devDependencies` package.json workspace-а (канон Storybook, Кластер 7);
 * hasStories шукає `*.stories.*` файли поза node_modules/dist/....
 */
import { describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { STORYBOOK_CANON_DEV_DEPS, hasStories, isStorybookRoot } from '../storybook.mjs'

/**
 * Тимчасова fixture-директорія workspace-а.
 * @param {Record<string, unknown>} pkg вміст package.json
 * @param {Record<string, string>} [files] відносний шлях → вміст
 * @returns {string} абсолютний шлях до тимчасового кореня
 */
function makeFixture(pkg, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'storybook-detect-'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content)
  }
  return dir
}

describe('isStorybookRoot', () => {
  test.each(STORYBOOK_CANON_DEV_DEPS)('true: identity-пакет %s у devDependencies', async name => {
    const dir = makeFixture({ devDependencies: { [name]: '9.1.10' } })
    expect(await isStorybookRoot(dir)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test('true: повний канонічний набір identity-devDeps', async () => {
    const dir = makeFixture({
      devDependencies: Object.fromEntries(STORYBOOK_CANON_DEV_DEPS.map(name => [name, '9.1.10']))
    })
    expect(await isStorybookRoot(dir)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test('false: identity-пакет у dependencies, а не devDependencies', async () => {
    const dir = makeFixture({ dependencies: { storybook: '9.1.10' } })
    expect(await isStorybookRoot(dir)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  test('false: @storybook/addon-vitest — root-only tooling, не identity-маркер', async () => {
    const dir = makeFixture({ devDependencies: { '@storybook/addon-vitest': '^9.0.0' } })
    expect(await isStorybookRoot(dir)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  test('false: тека .storybook/ без identity-devDeps — не сигнал', async () => {
    const dir = makeFixture({ devDependencies: { vitest: '^2.0.0' } })
    mkdirSync(join(dir, '.storybook'), { recursive: true })
    writeFileSync(join(dir, '.storybook', 'main.js'), 'export default {}\n')
    expect(await isStorybookRoot(dir)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  test('false: немає package.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'storybook-detect-no-pkg-'))
    expect(await isStorybookRoot(dir)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  test('false: package.json — невалідний JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'storybook-detect-bad-json-'))
    writeFileSync(join(dir, 'package.json'), '{ not valid json')
    expect(await isStorybookRoot(dir)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('hasStories', () => {
  test('true: знаходить Button.stories.js', async () => {
    const dir = makeFixture(
      { devDependencies: { storybook: '9.1.10' } },
      { 'src/components/Button.stories.js': 'export default {}\n' }
    )
    expect(await hasStories(dir)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test('true: знаходить .stories.ts поряд з .vue компонентом', async () => {
    const dir = makeFixture(
      {},
      {
        'src/Card.vue': '<template><div /></template>\n',
        'src/Card.stories.ts': 'export default {}\n'
      }
    )
    expect(await hasStories(dir)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test('false: немає жодного *.stories.* файлу', async () => {
    const dir = makeFixture({}, { 'src/Card.vue': '<template><div /></template>\n' })
    expect(await hasStories(dir)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  test('node_modules не скануються', async () => {
    const dir = makeFixture({}, { 'node_modules/pkg/Button.stories.js': 'export default {}\n' })
    expect(await hasStories(dir)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })
})
