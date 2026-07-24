/**
 * Тести guard-обгортки `bin/n-rules.js` (`if (isRunAsCli(import.meta.url)) { await runCli(...) }`).
 *
 * `runCli` мокається — реальний `n-rules-cli.mjs` тут не викликається (він і так покритий
 * окремими тестами `n-rules-cli.test.mjs`/`n-rules-helpers.test.mjs`/`n-rules-cwd.test.mjs`).
 * Мета цього файлу вужча: перевірити САМ guard у тонкому entry-файлі — обидві гілки
 * (`isRunAsCli` false/true), без чого `bin/n-rules.js` лишається на 0% line coverage
 * (subprocess-запуски в `scripts/dispatcher/tests/index.test.mjs` не рахуються у vitest
 * `--coverage`, бо йдуть в окремому `bun`-процесі).
 *
 * Для гілки "true" тимчасово підміняємо `process.argv[1]` на реальний шлях `n-rules.js`
 * (`isRunAsCli` звіряє `realpathSync` обох сторін) і робимо cache-bust динамічний `import()`
 * з унікальним query — інакше ESM-кеш віддав би вже імпортований (для гілки "false") модуль
 * без повторного виконання top-level guard.
 */
import { describe, expect, test, vi } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const runCliMock = vi.fn()
vi.mock('../n-rules-cli.mjs', () => ({ runCli: runCliMock }))

const here = dirname(fileURLToPath(import.meta.url))
const entryPath = join(here, '..', 'n-rules.js')
const entryUrl = pathToFileURL(entryPath).href

describe('bin/n-rules.js — guard за isRunAsCli', () => {
  test('імпорт (НЕ entry) — runCli не викликається', async () => {
    // eslint-disable-next-line no-unsanitized/method -- entryUrl будується з import.meta.url цього тестового файлу, не з зовнішнього вводу
    await import(entryUrl)
    expect(runCliMock).not.toHaveBeenCalled()
  })

  test('process.argv[1] === n-rules.js (entry) — runCli викликається з process.argv.slice(2)', async () => {
    const prevArgv1 = process.argv[1]
    const prevArgv = [...process.argv]
    process.argv[1] = entryPath
    process.argv.splice(2, process.argv.length, 'lint', '--help')
    try {
      // eslint-disable-next-line no-unsanitized/method -- cache-bust query з Date.now(), не з зовнішнього вводу
      await import(`${entryUrl}?run-as-cli=${Date.now()}`)
    } finally {
      process.argv[1] = prevArgv1
      process.argv.splice(0, process.argv.length, ...prevArgv)
    }
    expect(runCliMock).toHaveBeenCalledWith(['lint', '--help'])
  })
})
