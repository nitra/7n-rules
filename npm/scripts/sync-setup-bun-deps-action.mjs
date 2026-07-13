/**
 * Копіює composite GitHub Action `setup-bun-deps` з установленого пакету `@7n/rules`
 * у цільовий репозиторій (`.github/actions/setup-bun-deps/action.yml`).
 *
 * Використовується CLI `npx \@7n/rules`, щоб workflows з правил `ga` / `js` / `text`
 * могли одразу викликати `uses: ./.github/actions/setup-bun-deps` після кроку `actions/checkout@v6` (без checkout runner не знайде action.yml).
 *
 * Джерело: каталог `github-actions/setup-bun-deps/` у корені tarball пакету (поруч із `mdc/`, `bin/`).
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Відносний шлях до `action.yml` всередині кореня пакету */
const RELATIVE_BUNDLED_ACTION = join('github-actions', 'setup-bun-deps', 'action.yml')

/** Відносний шлях призначення у проєкті-клієнті */
const RELATIVE_DEST_ACTION = join('.github', 'actions', 'setup-bun-deps', 'action.yml')

/**
 * Записує у `projectRoot` composite action з `bundledPackageRoot` (корінь установленого `@7n/rules`).
 * @param {string} projectRoot абсолютний шлях до кореня цільового репозиторію
 * @param {string} bundledPackageRoot абсолютний шлях до кореня пакету (теки з `mdc/`, `github-actions/`)
 * @returns {Promise<{ written: boolean, destPath: string }>} чи був запис і повний шлях файлу
 */
export async function syncSetupBunDepsAction(projectRoot, bundledPackageRoot) {
  const srcPath = join(bundledPackageRoot, RELATIVE_BUNDLED_ACTION)
  if (!existsSync(srcPath)) {
    throw new Error(`Не знайдено шаблон composite action.\nОчікуваний шлях: ${srcPath}\nПеревстановіть @7n/rules.`)
  }
  const destPath = join(projectRoot, RELATIVE_DEST_ACTION)
  await mkdir(join(projectRoot, '.github', 'actions', 'setup-bun-deps'), { recursive: true })
  const content = await readFile(srcPath, 'utf8')
  await writeFile(destPath, content.endsWith('\n') ? content : `${content}\n`, 'utf8')
  return { written: true, destPath }
}
