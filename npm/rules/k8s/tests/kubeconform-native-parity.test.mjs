/**
 * Parity-гейт native-порту k8s-кластера: `crates/rules-core` ⇄ JS-канон
 * `npm/rules/k8s/**`.
 *
 * Дві поверхні:
 *
 * 1. **Шар відкриття файлів** (`k8s_common.rs`): `findK8sRoots` /
 *    `findK8sYamlFiles` з `k8s/manifests/main.mjs` проти однойменних
 *    napi-обгорток. Це спільна база всіх k8s-концернів, тож розходження тут
 *    зачепило б увесь кластер, а не один concern.
 *
 * 2. **Сам детектор `k8s/kubeconform`**: JS `lint(ctx)` проти
 *    `runNativeConcern('k8s/kubeconform', …)` на однакових деревах і з
 *    однаковим стабом тула (exit 0 / exit 1 / exit 127) — плюс перевірка, що
 *    без встановленого тула native НЕ мовчить, а делегує назад JS-канону.
 *
 * Обидві гілки детектора запускаються в **окремому процесі**
 * (`fixtures/kubeconform-parity-runner.mjs`): під Bun запис у `process.env` не
 * доходить до нативного `environ`, тож підставити стаб у `PATH` для Rust-боку
 * можна лише через `env` дочірнього процесу.
 *
 * # Чому гейт бере аддон із `target/`, а не через `loadNative()`
 *
 * `resolveNativeAddon` (`npm/scripts/lib/native.mjs`) віддає пріоритет
 * platform-пакету `@7n/rules-<platform>-<arch>`, а той у монорепо —
 * **закомічений** `.node`, який оновлюється лише на релізі. Тобто до релізу
 * `loadNative()` віддає збірку БЕЗ щойно доданих концернів, і parity-гейт
 * перевіряв би стару поверхню. Тут аддон береться напряму з `target/`
 * (`cargo build --release -p rules-napi` — той самий крок, що в `test.yml`),
 * а дочірні процеси отримують його через `N_RULES_NATIVE_ADDON`. Немає
 * збірки — гейт пропускається з явною причиною, а не «зеленіє» мовчки.
 */
import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'
import process, { env, execPath, platform } from 'node:process'
import { fileURLToPath } from 'node:url'

import { findK8sRoots, findK8sYamlFiles } from '../manifests/main.mjs'
import { realRepoRoot, withTmpDir } from '../../../scripts/utils/test-helpers.mjs'

const RUNNER = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'kubeconform-parity-runner.mjs')

/**
 * Ім'я cdylib-файлу `rules-napi` для поточної платформи (на Windows — без
 * `lib`-префікса, конвенція MSVC).
 * @returns {string} ім'я бібліотеки
 */
function cdylibName() {
  if (platform === 'darwin') return 'librules_napi.dylib'
  if (platform === 'win32') return 'rules_napi.dll'
  return 'librules_napi.so'
}

/**
 * Шлях до свіжозібраного аддона: явний `N_RULES_NATIVE_ADDON`, інакше
 * `target/{release,debug}/`. `null` — збірки немає (див. доккомент модуля).
 * @returns {string | null} шлях до аддона або null
 */
function freshAddonPath() {
  if (env.N_RULES_NATIVE_ADDON) return env.N_RULES_NATIVE_ADDON
  for (const profile of ['release', 'debug']) {
    const candidate = join(realRepoRoot(), 'target', profile, cdylibName())
    if (existsSync(candidate)) return candidate
  }
  return null
}

const ADDON_PATH = freshAddonPath()

/**
 * Завантажує свіжий аддон напряму через `dlopen` — так само, як це робить
 * `native.mjs`, але без його пріоритету platform-підпакета.
 * @returns {Record<string, (...args: never[]) => unknown>} exports аддона
 */
function freshAddon() {
  const mod = { exports: {} }
  process.dlopen(mod, ADDON_PATH)
  return mod.exports
}

// Пропуск має бути ГУЧНИМ: мовчазно зелений parity-гейт гірший за червоний.
if (ADDON_PATH === null) {
  console.warn(
    '⚠️ k8s/kubeconform parity-гейт пропущено: немає збірки rules-napi у target/ — прогони `cargo build --release -p rules-napi`'
  )
}

/**
 * Створює файл разом із батьківськими каталогами.
 * @param {string} root корінь тимчасового дерева
 * @param {string} rel відносний posix-шлях
 * @param {string} body вміст
 * @returns {Promise<void>}
 */
async function write(root, rel, body) {
  const abs = join(root, ...rel.split('/'))
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, body, 'utf8')
}

/**
 * Розкладає у `root` типове k8s-дерево: два різні `k8s`-корені, `.yml`-файл,
 * yaml поза `k8s`, і `.github/` (який обидві реалізації мають ігнорувати).
 * @param {string} root корінь тимчасового дерева
 * @returns {Promise<void>}
 */
async function seedK8sTree(root) {
  await write(root, 'svc-a/k8s/base/deploy.yaml', 'kind: Deployment\n')
  await write(root, 'svc-a/k8s/overlays/prod/kustomization.yaml', 'resources: []\n')
  await write(root, 'svc-b/k8s/base/svc.yaml', 'kind: Service\n')
  await write(root, 'svc-b/k8s/base/legacy.yml', 'kind: ConfigMap\n')
  await write(root, 'svc-c/plain/config.yaml', 'a: 1\n')
  await write(root, '.github/k8s/workflow.yaml', 'on: push\n')
  await write(root, 'svc-a/k8s/README.md', '# docs\n')
}

/**
 * Кладе у власний каталог виконуваний стаб `kubeconform` із заданим exit-кодом
 * і повертає цей каталог (для підстановки на початок `PATH`).
 * @param {string} root корінь тимчасового дерева
 * @param {number} exitCode код завершення стаба
 * @returns {Promise<string>} каталог зі стабом
 */
async function makeKubeconformStub(root, exitCode) {
  const dir = join(root, `stub-${exitCode}`)
  await mkdir(dir, { recursive: true })
  const isWin = platform === 'win32'
  const bin = join(dir, isWin ? 'kubeconform.cmd' : 'kubeconform')
  await writeFile(bin, isWin ? `@exit /b ${exitCode}\r\n` : `#!/bin/sh\nexit ${exitCode}\n`, 'utf8')
  if (!isWin) await chmod(bin, 0o755)
  return dir
}

/**
 * Ганяє одну реалізацію детектора в окремому процесі з явним `env`.
 * @param {'js'|'native'} mode яку гілку запускати
 * @param {string} root корінь перевірюваного дерева
 * @param {Record<string, string>} extraEnv додаткові змінні оточення
 * @returns {{ violations?: object[], error?: string }} результат раннера
 */
function runDetector(mode, root, extraEnv) {
  const result = spawnSync(execPath, [RUNNER, mode, root], {
    encoding: 'utf8',
    env: { ...env, N_RULES_NATIVE_ADDON: ADDON_PATH, ...extraEnv }
  })
  expect(result.error, `спавн раннера (${mode}) провалився`).toBeUndefined()
  expect(result.stdout, `раннер (${mode}) не вивів JSON; stderr: ${result.stderr}`).not.toBe('')
  return JSON.parse(result.stdout)
}

/**
 * `PATH` зі стабом на початку — спільний вхід для обох гілок.
 * @param {string} stubDir каталог зі стабом
 * @returns {Record<string, string>} env-патч
 */
function envWithStub(stubDir) {
  return { PATH: `${stubDir}${delimiter}${env.PATH ?? ''}` }
}

describe.skipIf(ADDON_PATH === null)('k8s_common ⇄ manifests/main.mjs — шар відкриття файлів', () => {
  test('findK8sRoots: native і JS дають однаковий список коренів', async () => {
    await withTmpDir(async root => {
      await seedK8sTree(root)
      const js = await findK8sRoots(root, [])
      const native = freshAddon().findK8sRoots(root, [])
      expect(native).toEqual(js)
      // Санітарна перевірка, що фікстура взагалі щось знайшла (інакше
      // порівняння двох порожніх масивів нічого б не доводило).
      expect(js).toHaveLength(2)
    })
  })

  test('findK8sYamlFiles: native і JS дають однаковий список файлів (разом із .yml)', async () => {
    await withTmpDir(async root => {
      await seedK8sTree(root)
      const js = await findK8sYamlFiles(root, [])
      const native = freshAddon().findK8sYamlFiles(root, [])
      expect(native).toEqual(js)
      expect(js.some(f => f.endsWith('legacy.yml'))).toBe(true)
      expect(js.some(f => f.includes('.github'))).toBe(false)
    })
  })

  test('обидві реалізації однаково поважають ignorePaths', async () => {
    await withTmpDir(async root => {
      await seedK8sTree(root)
      const ignore = [join(root, 'svc-b')]
      expect(freshAddon().findK8sRoots(root, ignore)).toEqual(await findK8sRoots(root, ignore))
      expect(freshAddon().findK8sYamlFiles(root, ignore)).toEqual(await findK8sYamlFiles(root, ignore))
      expect(await findK8sRoots(root, ignore)).toHaveLength(1)
    })
  })

  test('дерево без k8s: обидві реалізації дають порожньо', async () => {
    await withTmpDir(async root => {
      await write(root, 'src/app.yaml', 'a: 1\n')
      expect(freshAddon().findK8sRoots(root, [])).toEqual(await findK8sRoots(root, []))
      expect(freshAddon().findK8sRoots(root, [])).toEqual([])
    })
  })

  test('корінь із сегментом k8s у власному шляху не робить усе дерево k8s-ним', async () => {
    await withTmpDir(async outer => {
      const root = join(outer, 'k8s')
      await write(root, 'src/app.yaml', 'a: 1\n')
      await write(root, 'svc/k8s/base/deploy.yaml', 'kind: Deployment\n')
      expect(freshAddon().findK8sYamlFiles(root, [])).toEqual(await findK8sYamlFiles(root, []))
      expect(await findK8sYamlFiles(root, [])).toHaveLength(1)
    })
  })
})

describe.skipIf(ADDON_PATH === null)('k8s/kubeconform — native ⇄ JS на однакових деревах', () => {
  test('стаб exit 0: обидві гілки без порушень', async () => {
    await withTmpDir(async root => {
      await seedK8sTree(root)
      const patch = envWithStub(await makeKubeconformStub(root, 0))
      const js = runDetector('js', root, patch)
      const native = runDetector('native', root, patch)
      expect(js).toEqual({ violations: [] })
      expect(native).toEqual(js)
    })
  })

  test('стаб exit 1: обидві гілки дають ідентичне порушення', async () => {
    await withTmpDir(async root => {
      await seedK8sTree(root)
      const patch = envWithStub(await makeKubeconformStub(root, 1))
      const js = runDetector('js', root, patch)
      const native = runDetector('native', root, patch)
      expect(js.violations).toEqual([
        {
          reason: 'kubeconform',
          message: 'kubeconform знайшов невалідні маніфести (k8s.mdc)',
          severity: 'error',
          file: null
        }
      ])
      expect(native).toEqual(js)
    })
  })

  test('стаб exit 127: обидві гілки трактують як SKIP, не порушення', async () => {
    await withTmpDir(async root => {
      await seedK8sTree(root)
      const patch = envWithStub(await makeKubeconformStub(root, 127))
      const js = runDetector('js', root, patch)
      const native = runDetector('native', root, patch)
      expect(js).toEqual({ violations: [] })
      expect(native).toEqual(js)
    })
  })

  test('дерево без k8s-yaml: обидві гілки без порушень і без спавна тула', async () => {
    await withTmpDir(async root => {
      await write(root, 'src/app.yaml', 'a: 1\n')
      // Порожній `PATH`-патч: тул недосяжний, але цілей немає — жодна гілка
      // до резолву не доходить, тож і делегування не буде.
      const patch = { PATH: join(root, 'no-such-bin'), N_CURSOR_NO_AUTO_INSTALL: '1' }
      const js = runDetector('js', root, patch)
      const native = runDetector('native', root, patch)
      expect(js).toEqual({ violations: [] })
      expect(native).toEqual(js)
    })
  })
})

describe.skipIf(ADDON_PATH === null)('k8s/kubeconform — делегування назад JS-канону', () => {
  test('тул не встановлено, але цілі є → native кидає маркер делегування', async () => {
    await withTmpDir(async root => {
      await seedK8sTree(root)
      const marker = freshAddon().nativeDelegateMarker()
      const native = runDetector('native', root, {
        PATH: join(root, 'no-such-bin'),
        N_CURSOR_TOOL_CACHE_DIR: join(root, 'empty-cache'),
        N_CURSOR_NO_AUTO_INSTALL: '1'
      })
      expect(native.violations).toBeUndefined()
      expect(native.error).toContain(marker)
    })
  })

  test('registry: k8s/kubeconform зареєстрований і позначений як делегувальний', () => {
    const addon = freshAddon()
    expect(addon.listNativeConcerns()).toContain('k8s/kubeconform')
    expect(addon.listNativeDelegatingConcerns()).toContain('k8s/kubeconform')
    expect(addon.nativeDelegateMarker()).not.toBe('')
  })
})
