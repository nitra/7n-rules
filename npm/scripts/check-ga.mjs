/**
 * Перевіряє GitHub Actions за правилом ga.mdc.
 *
 * Workflows лише з розширенням `.yml`, наявність clean/lint workflow, конфіг zizmor з ref-pin,
 * відсутність MegaLinter, коректний скрипт `lint-ga` у `package.json`, виклик у `lint-ga.yml`,
 * наявність composite `.github/actions/setup-bun-deps/action.yml` (його записує `npx \@nitra/cursor`),
 * перед `uses: ./…/setup-bun-deps` у workflow — `actions/checkout` (runner інакше не бачить локальний action).
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { pass } from './utils/pass.mjs'

/** Шаблони наявності MegaLinter у вмісті workflow */
const MEGALINTER_USE_PATTERNS = [/oxsecurity\/megalinter-action/i, /megalinter\/megalinter/i]

/** Типові конфіги MegaLinter у корені репо */
const MEGALINTER_CONFIG_NAMES = ['.mega-linter.yml', '.megalinter.yaml', '.mega-linter.yaml']

/**
 * Якщо workflow викликає локальний setup-bun-deps, раніше у файлі має бути `actions/checkout@v…` (ga.mdc).
 * @param {string} relPath шлях для повідомлень
 * @param {string} content вміст YAML
 * @param {(msg: string) => void} failFn реєструє порушення (exit 1)
 * @param {(msg: string) => void} passFn реєструє успішну перевірку
 * @returns {void}
 */
function verifyCheckoutBeforeLocalSetupBunDeps(relPath, content, failFn, passFn) {
  const patterns = ['./.github/actions/setup-bun-deps', './npm/github-actions/setup-bun-deps']
  let idxSetup = -1
  for (const p of patterns) {
    const i = content.indexOf(p)
    if (i !== -1 && (idxSetup === -1 || i < idxSetup)) {
      idxSetup = i
    }
  }
  if (idxSetup === -1) {
    return
  }
  const idxCheckout = content.indexOf('actions/checkout@v')
  if (idxCheckout === -1 || idxCheckout > idxSetup) {
    failFn(
      `${relPath}: перед локальним setup-bun-deps потрібен крок actions/checkout@v6 — інакше runner не знайде action.yml (ga.mdc)`
    )
    return
  }
  passFn(`${relPath}: перед setup-bun-deps є checkout`)
}

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

  const setupBunDepsAction = '.github/actions/setup-bun-deps/action.yml'
  if (existsSync(setupBunDepsAction)) {
    pass(`${setupBunDepsAction} існує`)
  } else {
    fail(
      `Відсутній ${setupBunDepsAction} — запустіть npx @nitra/cursor або скопіюйте з пакету (ga.mdc: composite setup-bun-deps)`
    )
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

  const ymlWorkflows = files.filter(f => f.endsWith('.yml'))
  let foundMegalinter = false
  for (const f of ymlWorkflows) {
    const content = await readFile(join(wfDir, f), 'utf8')
    if (MEGALINTER_USE_PATTERNS.some(re => re.test(content))) {
      foundMegalinter = true
      fail(`MegaLinter у workflow ${wfDir}/${f} — видали інтеграцію (ga.mdc: MegaLinter)`)
    }
  }

  for (const name of MEGALINTER_CONFIG_NAMES) {
    if (existsSync(name)) {
      foundMegalinter = true
      fail(`Файл ${name} — видали конфіг MegaLinter (ga.mdc: MegaLinter)`)
    }
  }

  if (!foundMegalinter) {
    pass('Залишків MegaLinter не виявлено')
  }

  const zizmorPath = '.github/zizmor.yml'
  if (existsSync(zizmorPath)) {
    const z = await readFile(zizmorPath, 'utf8')
    pass(`${zizmorPath} існує`)
    if (z.includes('ref-pin')) {
      pass(`${zizmorPath} містить політику ref-pin (zizmor)`)
    } else {
      fail(`${zizmorPath}: додай policies ref-pin для unpinned-uses (ga.mdc)`)
    }
  } else {
    fail(`Відсутній ${zizmorPath} — потрібен для zizmor (ga.mdc)`)
  }

  if (existsSync('package.json')) {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'))
    const lg = pkg.scripts?.['lint-ga']
    if (typeof lg === 'string') {
      pass('package.json містить lint-ga')
      if (lg.includes('node-actionlint')) {
        pass('lint-ga викликає node-actionlint')
      } else {
        fail('lint-ga має містити bunx node-actionlint (ga.mdc)')
      }
      if (lg.includes('zizmor') && lg.includes('--offline')) {
        pass('lint-ga викликає zizmor з --offline')
      } else {
        fail('lint-ga має містити zizmor і --offline (ga.mdc)')
      }
    } else {
      fail('package.json: додай скрипт "lint-ga" (ga.mdc)')
    }
  } else {
    fail('package.json не існує — потрібен lint-ga у scripts')
  }

  const lintGaWf = join(wfDir, 'lint-ga.yml')
  if (existsSync(lintGaWf)) {
    const lgContent = await readFile(lintGaWf, 'utf8')
    if (lgContent.includes('bun run lint-ga')) {
      pass('lint-ga.yml викликає bun run lint-ga')
    } else {
      fail('lint-ga.yml: крок має містити bun run lint-ga')
    }
    if (lgContent.includes('astral-sh/setup-uv')) {
      pass('lint-ga.yml містить astral-sh/setup-uv')
    } else {
      fail('lint-ga.yml: додай astral-sh/setup-uv для uvx zizmor (ga.mdc)')
    }
    verifyCheckoutBeforeLocalSetupBunDeps(`${wfDir}/lint-ga.yml`, lgContent, fail, pass)
  }

  for (const wfName of ['lint-js.yml', 'lint-text.yml']) {
    const p = join(wfDir, wfName)
    if (existsSync(p)) {
      const body = await readFile(p, 'utf8')
      verifyCheckoutBeforeLocalSetupBunDeps(`${wfDir}/${wfName}`, body, fail, pass)
    }
  }

  return exitCode
}
