/**
 * Перевіряє GitHub Actions за правилом ga.mdc.
 *
 * Workflows лише з розширенням `.yml`, наявність clean/lint workflow, конфіг zizmor з ref-pin,
 * відсутність MegaLinter, коректний скрипт `lint-ga` у `package.json`, виклик у `lint-ga.yml`,
 * наявність composite `.github/actions/setup-bun-deps/action.yml` (його записує npx `\@nitra/cursor`),
 * перед `uses: ./…/setup-bun-deps` у workflow — `actions/checkout` (runner інакше не бачить локальний action).
 *
 * Заборонено дублювати кроки встановлення Bun та кешування безпосередньо у workflow файлах
 * (oven-sh/setup-bun, actions/cache, bun install). Перевірки `uses`/`run` виконуються після **YAML parse**
 * (`yaml`), щоб не спрацьовувати на випадкові збіги в коментарях або поза кроками.
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { pass } from './utils/pass.mjs'
import {
  anyRunStepIncludes,
  eventPathsIncludeExact,
  findForbiddenUsesOrRunPatterns,
  hasAnyStepUsesContaining,
  hasCheckoutBeforeLocalSetupBunDeps,
  parseWorkflowYaml
} from './utils/gha-workflow.mjs'

/** Шаблони наявності MegaLinter у вмісті workflow */
const MEGALINTER_USE_PATTERNS = [/oxsecurity\/megalinter-action/i, /megalinter\/megalinter/i]

/** Типові конфіги MegaLinter у корені репо */
const MEGALINTER_CONFIG_NAMES = ['.mega-linter.yml', '.megalinter.yaml', '.mega-linter.yaml']

/** Локальні composite setup-bun-deps (ga.mdc). */
const SETUP_BUN_PATTERNS = ['./.github/actions/setup-bun-deps', './npm/github-actions/setup-bun-deps']

/** Заборонені підрядки лише в кроках uses/run. */
const FORBIDDEN_BUN_PATTERNS = [
  { pattern: 'oven-sh/setup-bun', msg: 'використовуй .github/actions/setup-bun-deps замість oven-sh/setup-bun' },
  { pattern: 'actions/cache', msg: 'використовуй .github/actions/setup-bun-deps замість actions/cache' },
  { pattern: 'bun install', msg: 'використовуй .github/actions/setup-bun-deps замість bun install' }
]

/**
 * Якщо workflow викликає локальний setup-bun-deps, раніше у файлі має бути `actions/checkout@v…` (ga.mdc).
 * Fallback: сирий текст, якщо YAML не вдається розібрати.
 * @param {string} relPath шлях для повідомлень
 * @param {string} content вміст YAML
 * @param {(msg: string) => void} failFn реєструє порушення (exit 1)
 * @param {(msg: string) => void} passFn реєструє успішну перевірку
 * @returns {void}
 */
function verifyCheckoutBeforeLocalSetupBunDeps(relPath, content, failFn, passFn) {
  const root = parseWorkflowYaml(content)
  if (root) {
    if (!hasAnyStepUsesContaining(root, SETUP_BUN_PATTERNS)) {
      return
    }
    if (!hasCheckoutBeforeLocalSetupBunDeps(root, SETUP_BUN_PATTERNS)) {
      failFn(
        `${relPath}: перед локальним setup-bun-deps потрібен крок actions/checkout@v6 — інакше runner не знайде action.yml (ga.mdc)`
      )
      return
    }
    passFn(`${relPath}: перед setup-bun-deps є checkout`)
    return
  }
  let idxSetup = -1
  for (const p of SETUP_BUN_PATTERNS) {
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
 * Перевіряє заборонені кроки Bun/cache/install у `uses` та `run`.
 * @param {string} relPath шлях для повідомлень
 * @param {string} content вміст YAML
 * @param {(msg: string) => void} failFn реєструє порушення (exit 1)
 * @param {(msg: string) => void} passFn реєструє успішну перевірку
 * @returns {void}
 */
function verifyNoDirectBunOrCache(relPath, content, failFn, passFn) {
  const root = parseWorkflowYaml(content)
  if (root) {
    const hits = findForbiddenUsesOrRunPatterns(root, FORBIDDEN_BUN_PATTERNS)
    if (hits.length === 0) {
      passFn(`${relPath}: не містить заборонених кроків setup-bun/cache/install`)
    } else {
      for (const h of hits) {
        failFn(`${relPath}: ${h.msg} (ga.mdc)`)
      }
    }
    return
  }
  let foundForbidden = false
  for (const { pattern, msg } of FORBIDDEN_BUN_PATTERNS) {
    if (content.includes(pattern)) {
      failFn(`${relPath}: ${msg} (ga.mdc)`)
      foundForbidden = true
    }
  }
  if (!foundForbidden) {
    passFn(`${relPath}: не містить заборонених кроків setup-bun/cache/install`)
  }
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
    for (const f of yamlFiles) {
      fail(`Workflow з розширенням .yaml: ${wfDir}/${f} — перейменуй на .yml`)
    }
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
    const root = parseWorkflowYaml(content)
    const ok =
      root && eventPathsIncludeExact(root, 'push', '**/k8s/**/*.yaml') ? true : content.includes('**/k8s/**/*.yaml')
    if (ok) {
      pass('apply-k8s.yml має правильний paths trigger')
    } else {
      fail('apply-k8s.yml не містить paths: **/k8s/**/*.yaml')
    }
  }

  if (files.includes('apply-nats-consumer.yml')) {
    const content = await readFile(`${wfDir}/apply-nats-consumer.yml`, 'utf8')
    const root = parseWorkflowYaml(content)
    const ok =
      root && eventPathsIncludeExact(root, 'push', '**/consumer.yaml') ? true : content.includes('**/consumer.yaml')
    if (ok) {
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

  for (const f of ymlWorkflows) {
    const content = await readFile(join(wfDir, f), 'utf8')
    verifyCheckoutBeforeLocalSetupBunDeps(`${wfDir}/${f}`, content, fail, pass)
    verifyNoDirectBunOrCache(`${wfDir}/${f}`, content, fail, pass)
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
    const root = parseWorkflowYaml(lgContent)
    if (root) {
      if (anyRunStepIncludes(root, 'bun run lint-ga')) {
        pass('lint-ga.yml викликає bun run lint-ga')
      } else {
        fail('lint-ga.yml: крок має містити bun run lint-ga')
      }
      const usesFlat = hasAnyStepUsesContaining(root, ['astral-sh/setup-uv'])
      if (usesFlat || lgContent.includes('astral-sh/setup-uv')) {
        pass('lint-ga.yml містить astral-sh/setup-uv')
      } else {
        fail('lint-ga.yml: додай astral-sh/setup-uv для uvx zizmor (ga.mdc)')
      }
    } else {
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
    }
  }

  return exitCode
}
