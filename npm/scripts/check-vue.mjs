import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import { pass } from './utils/pass.mjs'

/**
 * Перевіряє відповідність проєкту правилам vue.mdc
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

  if (existsSync('package.json')) {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'))
    const deps = pkg.dependencies || {}
    const devDeps = pkg.devDependencies || {}
    const allDeps = { ...deps, ...devDeps }

    if (deps.vue) {
      pass(`vue в dependencies: ${deps.vue}`)
    } else {
      fail('vue відсутній в dependencies')
    }

    if (devDeps.vite) {
      const match = devDeps.vite.match(/(\d+)/)
      if (match && Number(match[1]) >= 8) {
        pass(`vite >= 8: ${devDeps.vite}`)
      } else {
        fail(`vite має бути >= 8, знайдено: ${devDeps.vite}`)
      }
    } else {
      fail('vite відсутній в devDependencies')
    }

    if (devDeps['@vitejs/plugin-vue']) {
      pass(`@vitejs/plugin-vue: ${devDeps['@vitejs/plugin-vue']}`)
    } else {
      fail('@vitejs/plugin-vue відсутній в devDependencies')
    }

    if (allDeps['vue-macros']) {
      pass(`vue-macros: ${allDeps['vue-macros']}`)
    } else {
      fail('vue-macros відсутній — bun add -d vue-macros')
    }

    if (allDeps['unplugin-auto-import']) {
      pass('unplugin-auto-import присутній')
    } else {
      fail('unplugin-auto-import відсутній — bun add -d unplugin-auto-import')
    }

    if (allDeps['vite-plugin-vue-layouts-next']) {
      pass('vite-plugin-vue-layouts-next присутній')
    } else {
      fail('vite-plugin-vue-layouts-next відсутній — bun add -d vite-plugin-vue-layouts-next')
    }
  }

  const configFiles = ['vite.config.js', 'vite.config.ts', 'vite.config.mjs']
  const viteConfig = configFiles.find(f => existsSync(f))
  if (viteConfig) {
    const content = await readFile(viteConfig, 'utf8')
    if (content.includes('VueMacros')) {
      pass('vite.config використовує VueMacros')
    } else {
      fail(`${viteConfig} не містить VueMacros`)
    }
    if (content.includes('AutoImport')) {
      pass('vite.config використовує AutoImport')
    } else {
      fail(`${viteConfig} не містить AutoImport`)
    }
  } else {
    fail('vite.config.js не існує')
  }

  return exitCode
}
