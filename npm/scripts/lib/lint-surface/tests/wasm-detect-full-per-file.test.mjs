/**
 * `--full` для `per-file` wasm-концернів (§2.65
 * `docs/plans/2026-08-05-open-questions-register.md`) — детект крізь
 * РЕАЛЬНИЙ napi-міст (`runWasmConcern`, `crates/rules-napi`), не крізь
 * ізольований guest-виклик (урок §2.47).
 *
 * # Що саме тут доводиться
 *
 * У full-прогоні планувальник лишає `item.files` невизначеним для КОЖНОГО
 * концерну (`rules_core::lint_plan::build_full_plan` — `files: None`), і
 * `detect.mjs` передає в napi `null`, розраховуючи, що хост побудує batch
 * за задекларованим glob-ом контрибуції. До §2.65 хост робив це ЛИШЕ для
 * `scope: Full`, а `per-file`-концерн діставав ПОРОЖНІЙ batch — нуль
 * файлів, нуль діагностик, «чисто». Мовчки: ні помилки, ні попередження.
 * Девʼять контрибуцій у чотирьох гостях у `--full` не перевірялись узагалі.
 *
 * Кожен тест нижче кладе на диск фікстуру з РЕАЛЬНИМ порушенням і кличе
 * `runWasmConcern(..., files: null)`: непорожній результат саме з іменем
 * файлу доводить, що гість справді отримав файли з диска, а не що «виклик
 * не впав». На коді ДО фіксу всі вони червоні (`violations: []`).
 *
 * # Чому по одному концерну на гостя
 *
 * Зміна лежить в ОДНІЙ host-функції (`build_detect_batch_files`), спільній
 * для всіх пʼятьох гостей, тож повторювати всі девʼять контрибуцій тут
 * було б дублюванням parity-гейтів. Береться по одному представнику класу:
 * чистий детектор (`vue/tfm-translations`, `rust/doc_comments`,
 * `python/doc_comments`) і tool-детектор із ЯКОРЕМ у батчі
 * (`python/ruff` — `pyproject.toml`, `php/mago_fmt` — `composer.json`):
 * саме другий клас вимагав розширити glob контрибуції (якорі
 * `concern.json.lint.anchors` живуть у JS-планувальнику, WIT-контрибуція
 * поля `anchors` не має — доккомент `build_detect_batch_files`).
 * `plugin-ci-github` перфайлових контрибуцій не має взагалі — його
 * представляє full-scope регресія (`ga/vscode_settings`), яка доводить, що
 * рефактор не зачепив стару гілку.
 */
import { existsSync } from 'node:fs'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { loadNative } from '../../native.mjs'
import { realRepoRoot, withTmpDir } from '../../../utils/test-helpers.mjs'

const REPO_ROOT = realRepoRoot()

/** Абсолютні шляхи зібраних `.wasm`-гостей — усі пʼять first-party плагінів. */
const WASM = {
  js: join(REPO_ROOT, 'target', 'wasm32-wasip2', 'release', 'plugin_lang_js.wasm'),
  python: join(REPO_ROOT, 'target', 'wasm32-wasip2', 'release', 'plugin_lang_python.wasm'),
  rust: join(REPO_ROOT, 'target', 'wasm32-wasip2', 'release', 'plugin_lang_rust.wasm'),
  php: join(REPO_ROOT, 'target', 'wasm32-wasip2', 'release', 'plugin_lang_php.wasm'),
  ciGithub: join(REPO_ROOT, 'target', 'wasm32-wasip2', 'release', 'plugin_ci_github.wasm')
}

for (const [name, path] of Object.entries(WASM)) {
  // Падіння з інструкцією, не мовчазний skip: без гостя цей файл нічого не
  // доводить (той самий мотив, що решта parity-тестів).
  if (!existsSync(path)) {
    throw new Error(
      `wasm-detect-full-per-file.test.mjs: wasm-гість ${name} не зібраний: ${path} відсутній.\n` +
        'Зберіть усіх: node npm/scripts/build-wasm-plugins.mjs'
    )
  }
}

/**
 * Пише файл разом із проміжними каталогами.
 * @param {string} dir абсолютний корінь tmp-репо
 * @param {string} rel posix-relative шлях усередині нього
 * @param {string} content вміст
 * @returns {Promise<void>} нічого
 */
async function writeFileDeep(dir, rel, content) {
  const abs = join(dir, rel)
  await mkdir(join(abs, '..'), { recursive: true })
  await writeFile(abs, content, 'utf8')
}

/**
 * Full-прогін одного концерну: `files: null` — рівно те, що передає
 * `detect.mjs` (`ctx.files ?? null`), коли планувальник не має явного
 * списку.
 * @param {string} wasmPath абсолютний шлях гостя
 * @param {string} key `ruleId/concernId`
 * @param {string} cwd корінь tmp-репо
 * @param {Record<string, string>} [toolPaths] мапа тулів (для tool-детекторів)
 * @returns {import('../detect.mjs').LintViolation[]} діагностики гостя
 */
function fullRun(wasmPath, key, cwd, toolPaths = {}) {
  return loadNative().runWasmConcern(wasmPath, key, cwd, null, toolPaths).violations
}

describe('runWasmConcern (files: null) — per-file концерн у --full реально перевіряється', () => {
  test('lang-js / vue/tfm-translations: .vue із порушенням знайдено обходом за glob-ом', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(
        dir,
        'src/Page.vue',
        "<script setup>\nimport { tf } from '@nitra/tfm'\nconst t = tf.bind({ tr: {} })\n</script>\n"
      )
      // Файл поза glob-ом (`**/*.vue`) — доказ, що batch саме фільтрований
      // обхід, а не «усе дерево».
      await writeFileDeep(dir, 'src/noise.txt', 'поза glob-ом\n')

      const violations = fullRun(WASM.js, 'vue/tfm-translations', dir)

      expect(violations.length).toBeGreaterThan(0)
      expect(violations.every(v => v.file === 'src/Page.vue')).toBe(true)
    })
  })

  test('lang-rust / rust/doc_comments: .rs без доккоментів знайдено обходом за glob-ом', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'src/a.rs', 'pub fn go() {}\n')

      const violations = fullRun(WASM.rust, 'rust/doc_comments', dir)

      expect(violations.length).toBeGreaterThan(0)
      expect(violations.some(v => v.file === 'src/a.rs')).toBe(true)
    })
  })

  test('lang-python / python/doc_comments: .py без доккоментів знайдено обходом за glob-ом', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'pkg/mod.py', 'def go():\n    return 1\n')

      const violations = fullRun(WASM.python, 'python/doc_comments', dir)

      expect(violations.length).toBeGreaterThan(0)
      expect(violations.some(v => v.file === 'pkg/mod.py')).toBe(true)
    })
  })
})

describe('runWasmConcern (files: null) — tool-детектори бачать і ЯКІР, і цільові файли', () => {
  /**
   * Пише виконуваний фейковий тул і повертає його абсолютний шлях —
   * детермінованість замість залежності від того, що встановлено на машині
   * (той самий прийом, що `writeFakeTool` у parity-тестах).
   * @param {string} dir абсолютний корінь tmp-репо
   * @param {string} name імʼя бінарника
   * @param {string} script тіло POSIX sh-скрипта (без shebang)
   * @returns {Promise<string>} абсолютний шлях
   */
  async function writeFakeTool(dir, name, script) {
    const binDir = join(dir, '.fake-bin')
    await mkdir(binDir, { recursive: true })
    const path = join(binDir, name)
    await writeFile(path, `#!/bin/sh\n${script}`, 'utf8')
    await chmod(path, 0o755)
    return path
  }

  test('lang-python / python/ruff: pyproject.toml у glob-і, `ruff check` реально спавниться', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'pyproject.toml', '[project]\nname = "demo"\n')
      await writeFileDeep(dir, 'pkg/mod.py', 'x=1\n')
      // Фейковий `uv`: probe доступності — 0, сам `ruff check` — 1 (є що
      // репортити). Дефолтна гілка падає голосно, щоб непередбачений виклик
      // не пройшов тихо.
      const uv = await writeFakeTool(
        dir,
        'uv',
        `case "$*" in
  "run --frozen ruff --version")
    exit 0
    ;;
  "run --frozen ruff check "*)
    echo "E401 fake ruff finding"
    exit 1
    ;;
  *)
    echo "fake uv: несподівані аргументи: $*" >&2
    exit 1
    ;;
esac
`
      )

      const violations = fullRun(WASM.python, 'python/ruff', dir, { uv })

      expect(violations.length).toBe(1)
      expect(violations[0].reason).toBe('ruff-check-violation')
      // Аргументи дійшли до тула — значить у батчі був і `.py`-файл, і якір
      // `pyproject.toml` (без якоря детектор мовчки повернув би `Skip`).
      expect(violations[0].message).toContain('E401 fake ruff finding')
    })
  })

  test('lang-php / php/mago_fmt: composer.json у glob-і, детектор доходить до спавну mago', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, 'composer.json', '{"name":"demo/app"}\n')
      await writeFileDeep(dir, 'src/App.php', '<?php\nclass App {}\n')

      // `toolPaths` порожній НАВМИСНО: нерезолвлений `mago` дає
      // `status: none`, який гість трактує як звичайне порушення
      // (доккомент `plugin-lang-php/src/lib.rs`, розділ «Канал „`mago`
      // недоступний“»). Наявність цієї діагностики і є доказом, що
      // детектор пройшов ОБИДВА guard-и (`composer.json` у батчі +
      // непорожній список `.php`), тобто batch справді побудований.
      const violations = fullRun(WASM.php, 'php/mago_fmt', dir)

      expect(violations.length).toBe(1)
      expect(violations[0].reason).toBe('mago-fmt-unformatted')
    })
  })
})

describe('runWasmConcern (files: null) — нерозвʼязний batch гучний, full-scope не зачеплено', () => {
  test('концерн, якого плагін не декларує, падає типізованою помилкою замість «чисто»', async () => {
    await withTmpDir(async dir => {
      expect(() => fullRun(WASM.js, 'demo/no-such-concern', dir)).toThrow(/no-such-concern/)
    })
  })

  test('plugin-ci-github: full-scope контрибуція резолвиться як раніше (регресія)', async () => {
    await withTmpDir(async dir => {
      await writeFileDeep(dir, '.vscode/settings.json', '{}\n')

      const violations = fullRun(WASM.ciGithub, 'ga/vscode_settings', dir)

      expect(violations.length).toBeGreaterThan(0)
    })
  })
})
