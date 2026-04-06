import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { pass } from './utils/pass.mjs'
import { getMonorepoPackageRootDirs } from './utils/workspaces.mjs'

/**
 * Формує зрозумілий для людини підпис пакета для повідомлень перевірки.
 * @param {string} rootDir відносний шлях (`'.'` або `site` тощо)
 * @returns {string} підпис для логів перевірки
 */
function packageLabel(rootDir) {
  return rootDir === '.' ? 'корінь' : rootDir
}

/**
 * Перевіряє залежності та vite.config одного Vue-пакета.
 * @param {string} rootDir відносний шлях до пакета
 * @param {(msg: string) => void} fail функція зворотного виклику для реєстрації помилки перевірки
 * @returns {Promise<void>} завершується після перевірок залежностей і Vite
 */
async function checkVuePackage(rootDir, fail) {
  const label = packageLabel(rootDir)
  const prefix = `[${label}] `

  const pkgPath = join(rootDir, 'package.json')
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
  const deps = pkg.dependencies || {}
  const devDeps = pkg.devDependencies || {}
  const allDeps = { ...deps, ...devDeps }

  if (deps.vue) {
    pass(`${prefix}vue в dependencies: ${deps.vue}`)
  } else {
    fail(`${prefix}vue відсутній в dependencies`)
  }

  if (devDeps.vite) {
    const match = devDeps.vite.match(/(\d+)/)
    if (match && Number(match[1]) >= 8) {
      pass(`${prefix}vite >= 8: ${devDeps.vite}`)
    } else {
      fail(`${prefix}vite має бути >= 8, знайдено: ${devDeps.vite}`)
    }
  } else {
    fail(`${prefix}vite відсутній в devDependencies`)
  }

  if (devDeps['@vitejs/plugin-vue']) {
    pass(`${prefix}@vitejs/plugin-vue: ${devDeps['@vitejs/plugin-vue']}`)
  } else {
    fail(`${prefix}@vitejs/plugin-vue відсутній в devDependencies`)
  }

  if (allDeps['vue-macros']) {
    pass(`${prefix}vue-macros: ${allDeps['vue-macros']}`)
  } else {
    fail(`${prefix}vue-macros відсутній — bun add -d vue-macros`)
  }

  if (allDeps['unplugin-auto-import']) {
    pass(`${prefix}unplugin-auto-import присутній`)
  } else {
    fail(`${prefix}unplugin-auto-import відсутній — bun add -d unplugin-auto-import`)
  }

  if (allDeps['vite-plugin-vue-layouts-next']) {
    pass(`${prefix}vite-plugin-vue-layouts-next присутній`)
  } else {
    fail(`${prefix}vite-plugin-vue-layouts-next відсутній — bun add -d vite-plugin-vue-layouts-next`)
  }

  const configFiles = ['vite.config.js', 'vite.config.ts', 'vite.config.mjs']
  const viteConfig = configFiles.find(f => existsSync(join(rootDir, f)))
  if (viteConfig) {
    const relConfig = join(rootDir, viteConfig)
    const content = await readFile(relConfig, 'utf8')
    if (content.includes('VueMacros')) {
      pass(`${prefix}${viteConfig} використовує VueMacros`)
    } else {
      fail(`${prefix}${viteConfig} не містить VueMacros`)
    }
    if (content.includes('AutoImport')) {
      pass(`${prefix}${viteConfig} використовує AutoImport`)
    } else {
      fail(`${prefix}${viteConfig} не містить AutoImport`)
    }
  } else {
    fail(`${prefix}немає vite.config.js|ts|mjs у каталозі пакета`)
  }
}

/**
 * Перевіряє відповідність проєкту правилам vue.mdc (корінь і всі workspace-пакети з `vue` у dependencies).
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  let exitCode = 0
  const fail = msg => {
    console.log(`  ❌ ${msg}`)
    exitCode = 1
  }

  if (existsSync('.vscode/extensions.json')) {
    const ext = JSON.parse(await readFile('.vscode/extensions.json', 'utf8'))
    if (ext.recommendations?.includes('Vue.volar')) {
      pass('extensions.json містить Vue.volar')
    } else {
      fail('extensions.json не містить Vue.volar — додай до recommendations')
    }
  } else {
    fail('.vscode/extensions.json не існує')
  }

  const roots = await getMonorepoPackageRootDirs()
  /** @type {string[]} */
  const vueRoots = []
  for (const r of roots) {
    const p = join(r, 'package.json')
    if (existsSync(p)) {
      const pkg = JSON.parse(await readFile(p, 'utf8'))
      if (pkg.dependencies?.vue) vueRoots.push(r)
    }
  }

  if (vueRoots.length === 0) {
    fail(
      'vue не знайдено в dependencies жодного пакета (корінь репо та каталоги з кореневого workspaces)'
    )
    return exitCode
  }

  for (const r of vueRoots) {
    await checkVuePackage(r, fail)
  }

  return exitCode
}
