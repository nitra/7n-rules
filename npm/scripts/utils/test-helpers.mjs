/**
 * Допоміжні функції для тестів скриптів пакета `@7n/rules`: тимчасові
 * каталоги (без мутації `process.cwd()`) та запис JSON у абсолютний шлях.
 *
 * **Без `process.chdir`.** Глобальна мутація `process.cwd()` ламає паралельні
 * vitest workers, що ділять один процес: один тест переключає cwd у tmpdir,
 * другий — назад у repo root посеред git-операцій першого. Інцидент:
 * `rules/changelog/.../check.test.mjs` робив `git init`+`git commit` із
 * `cwd: process.cwd()`, що в результаті race потрапляв у реальний робочий
 * каталог і створював rogue commits із автором `test <test@test>`.
 *
 * Контракт: `withTmpDir(fn)` створює tmp-каталог і передає його абсолютний шлях
 * у `fn`; тест явно будує `join(dir, …)` для будь-яких файлових операцій і
 * передає `cwd: dir` усім child-процесам (`execFile`, `spawnSync`) та
 * `await check(dir)` усім concern-функціям. Цей контракт обов'язковий — див.
 * перевірку `rules/test/js/no-process-chdir.mjs`.
 */
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { env, platform } from 'node:process'

/**
 * Абсолютний корінь реального монорепо (тека, де лежать і `npm/`, і `plugins/`),
 * стійкий до sandbox-копій Stryker. Sandbox (`npm/reports/stryker/.tmp/sandbox-*`)
 * містить копію лише пакета `npm/`, тому відносні шляхи типу `../../plugins/…`
 * від тестового файлу там порожні; цей хелпер натомість шукає маркери вгору від
 * власного розташування і з sandbox доходить до кореня справжнього робочого дерева.
 * Для тестів repo-інваріантів, яким потрібні файли поза пакетом (workflows,
 * плагінні rules-теки, пін llm-lib) — такі файли не мутуються Stryker-ом, читати
 * їх з реального дерева безпечно.
 * @returns {string} абсолютний шлях кореня монорепо
 * @throws {Error} якщо маркери `npm/` + `plugins/` не знайдено до кореня ФС
 */
export function realRepoRoot() {
  for (let dir = dirname(fileURLToPath(import.meta.url)); ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'plugins')) && existsSync(join(dir, 'npm'))) return dir
    if (dirname(dir) === dir) {
      throw new Error('realRepoRoot: не знайшов корінь монорепо (маркери npm/ + plugins/)')
    }
  }
}

/**
 * Резолвить шлях до зібраного бінаря `rules-cli` — той самий каскад, що loader
 * native-аддона (`npm/scripts/lib/native.mjs`): явний override
 * `N_RULES_CLI_BIN` → dev-збірка `target/{release,debug}`. Відсутність бінаря —
 * hard error з підказкою, а НЕ мовчазний skip: дірка в parity-гейті була б
 * невидимою (той самий Р1-мотив, що в loader-а аддона).
 * @returns {string} абсолютний шлях до бінаря `rules-cli`
 * @throws {Error} якщо бінар не зібрано і override не заданий
 */
export function resolveRulesCliBin() {
  const override = env.N_RULES_CLI_BIN
  if (override) return override
  const name = platform === 'win32' ? 'rules-cli.exe' : 'rules-cli'
  for (const profile of ['release', 'debug']) {
    const candidate = join(realRepoRoot(), 'target', profile, name)
    if (existsSync(candidate)) return candidate
  }
  throw new Error(
    'rules-cli parity: немає збірки бінаря. Постав N_RULES_CLI_BIN=/шлях/до/rules-cli ' +
      'або збери локально: cargo build --release -p rules-cli'
  )
}

/**
 * Створює тимчасову директорію, передає її абсолютний шлях у `fn`, потім
 * видаляє директорію. **НЕ** мутує `process.cwd()`.
 * @param {(dir: string) => void | Promise<void>} fn викликається з абсолютним шляхом до тимчасової директорії
 * @returns {Promise<void>} завершується після виконання `fn` і прибирання тимчасової директорії
 */
export async function withTmpDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'n-rules-test-'))
  try {
    await fn(dir)
  } finally {
    // maxRetries: git hooks (наприклад, ADR capture-decisions, що пише у .git/ai/rewrite_log)
    // можуть створювати файли всередині dir паралельно з recursive-walk у rm,
    // що породжує ENOTEMPTY на rmdir. Повтори з retryDelay=100ms ловлять цей race
    // без впливу на штатний випадок (де rm завершується з першої спроби).
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}

/**
 * Записує JSON-файл з типовим форматуванням і завершальним переносом рядка.
 * Аргумент `path` має бути абсолютним (від `withTmpDir`-callback-а через
 * `join(dir, relPath)`).
 * @param {string} path абсолютний шлях
 * @param {unknown} data об'єкт для серіалізації
 * @returns {Promise<void>}
 */
export async function writeJson(path, data) {
  if (!isAbsolute(path)) {
    throw new Error(`writeJson: шлях має бути абсолютним (отримано: ${path})`)
  }
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

/**
 * Створює вкладені каталоги. Аргумент `path` має бути абсолютним.
 * @param {string} path абсолютний шлях каталогу
 * @returns {Promise<void>} завершується після створення каталогу (і батьківських сегментів)
 */
export async function ensureDir(path) {
  if (!isAbsolute(path)) {
    throw new Error(`ensureDir: шлях має бути абсолютним (отримано: ${path})`)
  }
  await mkdir(path, { recursive: true })
}

/**
 * Створює тимчасовий каталог із порожнім виконуваним стабом `<bin>` (`<bin>.exe` на Windows,
 * `exit 0`), додає каталог на початок `PATH` для тривалості `fn` і потім відновлює оригінальний `PATH`.
 *
 * Дозволяє ганяти перевірки, що спавнять зовнішні тули, на машинах без реального бінарника
 * (`resolveCmd(bin)`/`ensureTool(bin)` знайдуть стаб через PATH) і, головне, детерміновано
 * замінює повільні мережево-залежні тули у тестах: наприклад, реальний `kubescape scan`
 * на старті тягне артефакти/конфіг із хмарних API (десятки секунд wall-time на
 * повільній або закритій мережі), що ламає `testTimeout`.
 * @param {string} bin ім'я виконуваного файлу стаба (без `.exe`)
 * @param {() => void | Promise<void>} fn виконується з підставленим стабом у PATH
 * @returns {Promise<void>}
 */
export async function withBinStubInPath(bin, fn) {
  const dir = await mkdtemp(join(tmpdir(), `n-rules-${bin}-stub-`))
  const isWin = platform === 'win32'
  const stub = join(dir, isWin ? `${bin}.exe` : bin)
  await writeFile(stub, isWin ? '' : '#!/bin/sh\nexit 0\n', 'utf8')
  if (!isWin) await chmod(stub, 0o755)
  const prevPath = env.PATH
  env.PATH = `${dir}${delimiter}${prevPath ?? ''}`
  try {
    await fn()
  } finally {
    if (prevPath === undefined) {
      delete env.PATH
    } else {
      env.PATH = prevPath
    }
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * Спеціалізація {@link withBinStubInPath} для shellcheck: дозволяє ганяти `check ga`
 * у тестах на машинах без реального shellcheck. Реальний shellcheck не запускається.
 * @param {() => void | Promise<void>} fn виконується з підставленим shellcheck-стабом
 * @returns {Promise<void>}
 */
export async function withShellcheckStubInPath(fn) {
  await withBinStubInPath('shellcheck', fn)
}

/**
 * Виконує `fn` із `PATH`, з якого видалені всі каталоги, що містять виконуваний `<bin>`.
 * Залишок `PATH` не змінюємо — git/bun лишаються доступними. Після `fn` оригінальний `PATH` повертаємо.
 *
 * Потрібно для негативних тестів («fail, коли інструмента нема»), що мають працювати на машинах,
 * де користувач уже встановив цей інструмент глобально (наприклад, `brew install shellcheck`).
 *
 * Додатково виставляє `N_CURSOR_NO_AUTO_INSTALL=1` на час `fn`: інструменти, що резолвляться
 * через `ensureTool`, інакше спробували б **реальний** brew/scoop/curl-install під час тесту.
 *
 * Ізолює й кеш-каталог `ensureTool` (`getCacheDir()` у `ensure-tool.mjs`: типово
 * `~/.cache/@7n/rules/bin/` на POSIX, `%LOCALAPPDATA%\@7n\rules\bin\` на Windows) —
 * через `N_CURSOR_TOOL_CACHE_DIR` (свіжий порожній tmp-каталог на час `fn`), а НЕ
 * підміною `HOME`/`LOCALAPPDATA`: під Bun (`bun run --bun vitest` — канонічний
 * CI-запуск) `os.homedir()` резолвиться один раз при старті процесу й ігнорує
 * runtime-зміну `process.env.HOME` (на відміну від Node.js) — підміна HOME тут
 * виглядала б робочою локально (під `node`/`npx vitest`), але мовчки не спрацьовувала
 * б під реальним CI-раннером. Без цієї ізоляції `ensureTool` бачить лише PATH-крок
 * negative-тесту: якщо тул уже закешований (інший тест того ж vitest-прогону чи
 * попередній CI-крок його авто-встановив у спільний `~/.cache/@7n/rules/bin/`), крок 2
 * (перевірка кешу) резолвить бінарник МИНАЮЧИ і PATH-фільтр, і `N_CURSOR_NO_AUTO_INSTALL`
 * — негативний тест тоді хибно не кидає (спостережено на чистих GitHub ubuntu-runner-ах:
 * auto-install з `GITHUB_TOKEN` реально встановлює тул у той самий процес).
 * @param {string} bin ім'я виконуваного файлу (на Windows додасться `.exe`)
 * @param {() => void | Promise<void>} fn тестовий код, що очікує відсутність бінарника в PATH
 * @returns {Promise<void>}
 */
export async function withBinRemovedFromPath(bin, fn) {
  const isWin = platform === 'win32'
  const candidates = isWin ? [`${bin}.exe`, bin] : [bin]
  const prevPath = env.PATH
  const prevNoInstall = env['N_CURSOR_NO_AUTO_INSTALL']
  const prevCacheDir = env['N_CURSOR_TOOL_CACHE_DIR']
  const filtered = (prevPath ?? '')
    .split(delimiter)
    .filter(d => d && candidates.every(name => !existsSync(join(d, name))))
    .join(delimiter)
  env.PATH = filtered
  env['N_CURSOR_NO_AUTO_INSTALL'] = '1'
  const isolatedCacheDir = await mkdtemp(join(tmpdir(), 'n-rules-isolated-tool-cache-'))
  env['N_CURSOR_TOOL_CACHE_DIR'] = isolatedCacheDir
  try {
    await fn()
  } finally {
    if (prevPath === undefined) {
      delete env.PATH
    } else {
      env.PATH = prevPath
    }
    if (prevNoInstall === undefined) {
      delete env['N_CURSOR_NO_AUTO_INSTALL']
    } else {
      env['N_CURSOR_NO_AUTO_INSTALL'] = prevNoInstall
    }
    if (prevCacheDir === undefined) {
      delete env['N_CURSOR_TOOL_CACHE_DIR']
    } else {
      env['N_CURSOR_TOOL_CACHE_DIR'] = prevCacheDir
    }
    await rm(isolatedCacheDir, { recursive: true, force: true })
  }
}

/**
 * Ставить у tmp-репо фейковий плагін `@7n/rules-lang-js` (маніфест API v2 з
 * `doc-files.extensions@1` contribution — JS-екосистема) і активує його через `.n-rules.json`.
 * Потрібен тестам doc-files: ядро не має вбудованих кодових розширень — без активного
 * lang-плагіна скан не бачить жодного джерела (Фаза 2, spec
 * 2026-07-27-universal-plugin-slots-lang-php-extraction — переведено на slot bus).
 * @param {string} dir абсолютний корінь tmp-репо (від `withTmpDir`)
 * @returns {Promise<void>}
 */
export async function installFakeLangJsPlugin(dir) {
  const pkgRoot = join(dir, 'node_modules', '@7n', 'rules-lang-js')
  await mkdir(pkgRoot, { recursive: true })
  await writeFile(
    join(pkgRoot, 'package.json'),
    JSON.stringify({
      name: '@7n/rules-lang-js',
      version: '0.0.0-test',
      'n-rules': {
        requiresPluginApi: 2,
        slots: {
          provides: [
            {
              slot: 'doc-files.extensions',
              version: 1,
              id: 'doc-files-ext-js',
              value: { '.js': 'JS Module', '.mjs': 'JS Module', '.ts': 'TS Module', '.vue': 'Vue Component' }
            }
          ]
        }
      }
    })
  )
  await writeFile(join(dir, '.n-rules.json'), JSON.stringify({ plugins: ['@7n/rules-lang-js'] }))
}
