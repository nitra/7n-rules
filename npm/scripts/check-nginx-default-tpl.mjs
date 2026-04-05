import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

/**
 * Перевіряє відповідність проєкту правилам nginx-default-tpl.mdc
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  let exitCode = 0
  const pass = msg => console.log(`  ✅ ${msg}`)
  const fail = msg => {
    console.log(`  ❌ ${msg}`)
    exitCode = 1
  }

  if (existsSync('default.tpl.conf')) {
    fail('default.tpl.conf існує — перейменуй на default.conf.template')
  }

  const tplLocations = ['default.conf.template', 'nginx/default.conf.template', 'docker/default.conf.template']
  const found = tplLocations.find(f => existsSync(f))

  if (found) {
    pass(`${found} існує`)
    const content = await readFile(found, 'utf8')

    content.includes('listen 8080')
      ? pass('Nginx слухає порт 8080')
      : fail(`${found}: має містити listen 8080`)

    content.includes('/healthz')
      ? pass('Є location /healthz')
      : fail(`${found}: відсутній location /healthz`)

    content.includes('gzip_static on')
      ? pass('gzip_static увімкнено')
      : fail(`${found}: має містити gzip_static on`)

    if (content.includes('proxy_pass')) {
      fail(`${found} містить proxy_pass — перенеси проксі-логіку до HTTPRoute в k8s`)
    }
  }

  if (existsSync('.vscode/extensions.json')) {
    const ext = JSON.parse(await readFile('.vscode/extensions.json', 'utf8'))
    ext.recommendations?.includes('ahmadalli.vscode-nginx-conf')
      ? pass('extensions.json містить ahmadalli.vscode-nginx-conf')
      : fail('extensions.json не містить ahmadalli.vscode-nginx-conf')
  }

  if (existsSync('.vscode/settings.json')) {
    const s = JSON.parse(await readFile('.vscode/settings.json', 'utf8'))
    s['[nginx]']?.['editor.defaultFormatter'] === 'ahmadalli.vscode-nginx-conf'
      ? pass('settings.json: nginx formatter налаштовано')
      : fail('settings.json: [nginx] defaultFormatter має бути ahmadalli.vscode-nginx-conf')
  }

  return exitCode
}
