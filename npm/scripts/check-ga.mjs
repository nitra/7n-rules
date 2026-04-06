import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'

import { pass } from './utils/pass.mjs'

/**
 * Перевіряє відповідність проєкту правилам ga.mdc
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  let exitCode = 0
  const fail = msg => {
    console.log(`  ❌ ${msg}`)
    exitCode = 1
  }

  const wfDir = '.github/workflows'

  if (!existsSync(wfDir)) {
    fail(`Директорія ${wfDir} не існує`)
    return exitCode
  }

  const files = await readdir(wfDir)

  const yamlFiles = files.filter(f => f.endsWith('.yaml'))
  if (yamlFiles.length > 0) {
    for (const f of yamlFiles) fail(`Workflow з розширенням .yaml: ${wfDir}/${f} — перейменуй на .yml`)
  } else {
    pass('Всі workflows мають розширення .yml')
  }

  for (const f of ['clean-ga-workflows.yml', 'clean-merged-branch.yml', 'lint-ga.yml']) {
    if (files.includes(f)) {
      pass(`${f} існує`)
    } else {
      fail(`Відсутній ${wfDir}/${f}`)
    }
  }

  if (files.includes('apply-k8s.yml')) {
    const content = await readFile(`${wfDir}/apply-k8s.yml`, 'utf8')
    if (content.includes('**/k8s/*.yaml')) {
      pass('apply-k8s.yml має правильний paths trigger')
    } else {
      fail('apply-k8s.yml не містить paths: **/k8s/*.yaml')
    }
  }

  if (files.includes('apply-nats-consumer.yml')) {
    const content = await readFile(`${wfDir}/apply-nats-consumer.yml`, 'utf8')
    if (content.includes('**/consumer.yaml')) {
      pass('apply-nats-consumer.yml має правильний paths trigger')
    } else {
      fail('apply-nats-consumer.yml не містить paths: **/consumer.yaml')
    }
  }

  if (existsSync('.vscode/extensions.json')) {
    const ext = JSON.parse(await readFile('.vscode/extensions.json', 'utf8'))
    if (ext.recommendations?.includes('github.vscode-github-actions')) {
      pass('extensions.json містить github.vscode-github-actions')
    } else {
      fail('extensions.json не містить github.vscode-github-actions')
    }
  } else {
    fail('.vscode/extensions.json не існує')
  }

  return exitCode
}
