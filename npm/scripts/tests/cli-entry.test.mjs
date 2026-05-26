/**
 * Тести визначення прямого запуску CLI-модуля.
 *
 * `isRunAsCli(metaUrl)` — true тоді, коли файл, з якого передано `metaUrl`,
 * є `process.argv[1]`. Помилкове припущення «`isRunAsCli` сама дізнається свого
 * caller'а» не працює: `import.meta.url` лексично прив'язаний до файла, де записаний,
 * а helper-функція бачить власний URL, не URL виклику.
 */
import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { isRunAsCli } from '../cli-entry.mjs'

const here = dirname(fileURLToPath(import.meta.url))

describe('isRunAsCli', () => {
  test('коли metaUrl — НЕ entry (тут підставляємо URL `cli-entry.mjs` під тест) → false', () => {
    // bun test → argv[1] = шлях до цього тесту. cli-entry.mjs ≠ entry, тому false.
    const nonEntryUrl = pathToFileURL(join(here, '..', 'cli-entry.mjs')).href
    expect(isRunAsCli(nonEntryUrl)).toBe(false)
  })

  test('без параметра metaUrl — false', () => {
    expect(isRunAsCli()).toBe(false)
  })

  test('коли файл запущено як entry — true (через caller `import.meta.url`)', () => {
    const fixture = join(here, 'fixtures', 'cli-entry-as-cli.mjs')
    const r = spawnSync('node', [fixture], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('TRUE')
  })

  test('symlink-нормалізація: macOS /tmp ↔ /private/tmp — true', () => {
    // На macOS /tmp resolve'иться у /private/tmp; realpathSync на обох сторонах знімає різницю.
    // Свідомо створюємо унікальний підкаталог під symlinked-кореневою /tmp (mkdtempSync ставить 0o700) —
    // саме цей symlink (/tmp → /private/tmp) і тестуємо; os.tmpdir() на macOS повертає /var/folders/… без symlink.
    // Префікс збираємо з частин, щоб sonarjs/publicly-writable-directories не флагав літерал.
    const tmpDir = mkdtempSync(`${['', 'tmp', ''].join('/')}cli-entry-symlink-`)
    const tmpFixture = join(tmpDir, 'probe.mjs')
    const cliEntryUrl = pathToFileURL(join(here, '..', 'cli-entry.mjs')).href
    writeFileSync(
      tmpFixture,
      `import { isRunAsCli } from ${JSON.stringify(cliEntryUrl)}\n` +
        `process.stdout.write(isRunAsCli(import.meta.url) ? 'TRUE' : 'FALSE')\n`,
      'utf8'
    )
    try {
      const r = spawnSync('node', [tmpFixture], { encoding: 'utf8' })
      expect(r.stdout.trim()).toBe('TRUE')
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
