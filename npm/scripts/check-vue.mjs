import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

/**
 * Перевіряє відповідність проєкту правилам vue.mdc
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  let exitCode = 0
  const pass = msg => console.log(`  ✅ ${msg}`)
  const fail = msg => {
    console.log(`  ❌ ${msg}`)
    exitCode = 1
  }

  if (existsSync('.vscode/extensions.json')) {
    const ext = JSON.parse(await readFile('.vscode/extensions.json', 'utf8'))
    ext.recommendations?.includes('Vue.volar')
      ? pass('extensions.json містить Vue.volar')
      : fail('extensions.json не містить Vue.volar — додай до recommendations')
  } else {
    fail('.vscode/extensions.json не існує')
  }

  if (existsSync('package.json')) {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'))
    const deps = pkg.dependencies || {}
    const devDeps = pkg.devDependencies || {}
    const allDeps = { ...deps, ...devDeps }

    deps.vue ? pass(`vue в dependencies: ${deps.vue}`) : fail('vue відсутній в dependencies')

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

    devDeps['@vitejs/plugin-vue']
      ? pass(`@vitejs/plugin-vue: ${devDeps['@vitejs/plugin-vue']}`)
      : fail('@vitejs/plugin-vue відсутній в devDependencies')

    allDeps['vue-macros']
      ? pass(`vue-macros: ${allDeps['vue-macros']}`)
      : fail('vue-macros відсутній — bun add -d vue-macros')

    allDeps['unplugin-auto-import']
      ? pass('unplugin-auto-import присутній')
      : fail('unplugin-auto-import відсутній — bun add -d unplugin-auto-import')

    allDeps['vite-plugin-vue-layouts-next']
      ? pass('vite-plugin-vue-layouts-next присутній')
      : fail('vite-plugin-vue-layouts-next відсутній — bun add -d vite-plugin-vue-layouts-next')
  }

  const configFiles = ['vite.config.js', 'vite.config.ts', 'vite.config.mjs']
  const viteConfig = configFiles.find(f => existsSync(f))
  if (viteConfig) {
    const content = await readFile(viteConfig, 'utf8')
    content.includes('VueMacros') ? pass('vite.config використовує VueMacros') : fail(`${viteConfig} не містить VueMacros`)
    content.includes('AutoImport') ? pass('vite.config використовує AutoImport') : fail(`${viteConfig} не містить AutoImport`)
  } else {
    fail('vite.config.js не існує')
  }

  return exitCode
}
