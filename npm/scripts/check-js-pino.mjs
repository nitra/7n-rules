import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

/**
 * Перевіряє відповідність проєкту правилам js-pino.mdc
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  let exitCode = 0
  const pass = msg => console.log(`  ✅ ${msg}`)
  const fail = msg => {
    console.log(`  ❌ ${msg}`)
    exitCode = 1
  }

  if (existsSync('package.json')) {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'))
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }

    if (allDeps['@nitra/bunyan']) fail('@nitra/bunyan знайдено — замінити на @nitra/pino')
    if (allDeps.bunyan) fail('bunyan знайдено — замінити на @nitra/pino')
  }

  if (existsSync('k8s/base/configmap.yaml')) {
    const content = await readFile('k8s/base/configmap.yaml', 'utf8')
    if (content.includes('OTEL_RESOURCE_ATTRIBUTES')) {
      pass('k8s/base/configmap.yaml містить OTEL_RESOURCE_ATTRIBUTES')
      if (content.includes('service.name=') && content.includes('service.namespace=')) {
        pass('OTEL_RESOURCE_ATTRIBUTES містить service.name та service.namespace')
      } else {
        fail('OTEL_RESOURCE_ATTRIBUTES має містити service.name=<name>,service.namespace=<namespace>')
      }
    } else {
      fail('k8s/base/configmap.yaml не містить OTEL_RESOURCE_ATTRIBUTES')
    }
  }

  return exitCode
}
