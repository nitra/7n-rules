/**
 * Перевіряє структуру npm-модуля в монорепо за правилом npm-module.mdc.
 *
 * Workspace `npm/`, `npm/package.json`, workflow `npm-publish.yml` з OIDC, `on.push.paths` з glob для каталогу npm.
 *
 * Якщо під `npm/src` є хоча б один файл `.js`, очікується канонічний layout: `types` → `./types/index.d.ts`,
 * згенерований `index.d.ts` у `npm/types/`, і hk з викликом `tsc` по файлах під `npm/src`.
 *
 * Якщо таких файлів немає — layout через `npm/tsconfig.emit-types.json`: поле `types` має вказувати на існуючий
 * файл під `./types/…`, у hk — `tsc -p tsconfig.emit-types.json`, у JSON-конфігу — потрібні compilerOptions для emit.
 *
 * Поля workflow перевіряються після **YAML parse**, щоб не плутати з коментарями.
 */
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { createCheckReporter } from './utils/check-reporter.mjs'
import {
  hasIdTokenWritePermission,
  hasNpmPublishStepWithPackage,
  parseWorkflowYaml,
  pushHasMainBranch,
  pushPathsIncludeNpmGlob
} from './utils/gha-workflow.mjs'
import { walkDir } from './utils/walkDir.mjs'

/** Канонічний entrypoint типів для пакетів із вихідним `.js` під каталогом `npm/src` */
const TYPES_INDEX = './types/index.d.ts'

/** Файл проєкту TypeScript для emit без каталогу `src` (див. npm-module.mdc) */
const EMIT_TYPES_CONFIG = 'npm/tsconfig.emit-types.json'

/**
 * Чи є під `npm/src` хоча б один `.js` (рекурсивно).
 * @returns {Promise<boolean>} `true`, якщо знайдено хоча б один `.js`
 */
async function npmSrcTreeHasJsFile() {
  const root = 'npm/src'
  if (!existsSync(root)) {
    return false
  }
  let found = false
  await walkDir(root, p => {
    if (p.endsWith('.js')) {
      found = true
    }
  })
  return found
}

/**
 * Знаходить текстовий вміст конфігурації hk для перевірки npm-module.
 * @returns {Promise<{ path: string, text: string } | null>} знайдений файл або `null`
 */
async function readHkConfig() {
  const candidates = ['hk.pkl', '.config/hk.pkl']
  for (const p of candidates) {
    if (existsSync(p)) {
      const text = await readFile(p, 'utf8')
      return { path: p, text }
    }
  }
  return null
}

/**
 * Підрядки для hk при layout з каталогом `npm/src` і glob `src` + `.js` у команді (див. npm-module.mdc).
 * @param {string} hkText текст конфігурації hk
 * @returns {string[]} відсутні фрагменти
 */
function missingHkSrcLayoutFragments(hkText) {
  const need = [
    '["pre-commit"]',
    'bunx -p typescript tsc',
    'src/**/*.js',
    '--declaration',
    '--allowJs',
    '--emitDeclarationOnly',
    '--outDir types',
    '--skipLibCheck'
  ]
  return need.filter(s => !hkText.includes(s))
}

/**
 * Підрядки для hk при layout з `tsconfig.emit-types.json` (див. npm-module.mdc).
 * @param {string} hkText текст конфігурації hk
 * @returns {string[]} відсутні фрагменти
 */
function missingHkEmitTypesConfigFragments(hkText) {
  const need = ['["pre-commit"]', 'bunx -p typescript tsc', 'tsconfig.emit-types.json']
  return need.filter(s => !hkText.includes(s))
}

/**
 * Перевіряє `npm/tsconfig.emit-types.json` на мінімальний набір опцій для `emitDeclarationOnly` у `types/`.
 * @param {unknown} parsed результат `JSON.parse` конфігурації
 * @returns {string[]} повідомлення про помилки (порожній — OK)
 */
function emitTypesConfigIssues(parsed) {
  const issues = []
  if (!parsed || typeof parsed !== 'object') {
    return ['некоректний JSON']
  }
  const co = /** @type {{ [k: string]: unknown }} */ (parsed).compilerOptions
  if (!co || typeof co !== 'object') {
    return ['відсутній compilerOptions']
  }
  const get = k => /** @type {{ [k: string]: unknown }} */ (co)[k]
  if (get('allowJs') !== true) {
    issues.push('compilerOptions.allowJs має бути true')
  }
  if (get('declaration') !== true) {
    issues.push('compilerOptions.declaration має бути true')
  }
  if (get('emitDeclarationOnly') !== true) {
    issues.push('compilerOptions.emitDeclarationOnly має бути true')
  }
  if (get('outDir') !== 'types') {
    issues.push('compilerOptions.outDir має бути "types"')
  }
  if (get('skipLibCheck') !== true) {
    issues.push('compilerOptions.skipLibCheck має бути true')
  }
  return issues
}

/**
 * Шлях на дискі до файлу з поля `types` у `npm/package.json` (значення на кшталт `./types/bin/x.d.ts`).
 * @param {string} typesField значення поля `types` з `package.json`
 * @returns {string | null} абсолютний шлях або `null`
 */
function npmTypesFileFromPackageField(typesField) {
  if (typeof typesField !== 'string' || !typesField.startsWith('./types/')) {
    return null
  }
  const rel = typesField.slice(2)
  return join('npm', rel)
}

/**
 * Перевіряє відповідність проєкту правилам npm-module.mdc
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  if (existsSync('package.json')) {
    pass('package.json існує')
  } else {
    fail('package.json не існує')
  }

  if (existsSync('npm')) {
    const s = await stat('npm')
    if (s.isDirectory()) {
      pass('npm/ директорія існує')
    } else {
      fail('npm має бути директорією')
    }
  } else {
    fail('npm/ директорія не існує')
  }

  if (existsSync('package.json')) {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'))
    const ws = pkg.workspaces
    if (Array.isArray(ws) && ws.includes('npm')) {
      pass('package.json workspaces містить "npm"')
    } else {
      fail('package.json workspaces має містити "npm"')
    }
  }

  if (existsSync('npm/package.json')) {
    pass('npm/package.json існує')
  } else {
    fail('npm/package.json не існує — створи package.json для npm модуля')
  }

  const useSrcJsLayout = await npmSrcTreeHasJsFile()

  if (existsSync('npm/package.json')) {
    const npmPkg = JSON.parse(await readFile('npm/package.json', 'utf8'))
    const typesField = npmPkg.types

    if (useSrcJsLayout) {
      if (typesField === TYPES_INDEX) {
        pass(`npm/package.json: "types": "${TYPES_INDEX}" (layout npm/src + .js)`)
      } else {
        fail(`npm/package.json: при наявності .js під npm/src очікується "types": "${TYPES_INDEX}"`)
      }
    } else {
      if (typeof typesField === 'string' && /^\.\/types\/.+\.d\.(ts|mts)$/.test(typesField)) {
        pass(`npm/package.json: "types" вказує на файл під ./types/… (${typesField})`)
      } else {
        fail(
          'npm/package.json: без .js під npm/src поле types має бути рядком виду ./types/….d.ts або .d.mts (див. npm-module.mdc)'
        )
      }
    }

    const files = npmPkg.files
    if (Array.isArray(files) && files.includes('types')) {
      pass('npm/package.json: files містить "types"')
    } else {
      fail('npm/package.json: масив files має містити "types"')
    }

    const typesPath = useSrcJsLayout ? join('npm', 'types', 'index.d.ts') : npmTypesFileFromPackageField(typesField)
    if (typesPath && existsSync(typesPath)) {
      pass(`${typesPath} існує`)
    } else {
      fail(
        useSrcJsLayout
          ? `Відсутній ${join('npm', 'types', 'index.d.ts')} (згенеруй tsc з npm-module.mdc)`
          : `Файл для поля types не знайдено або шлях не під ./types/ — ${String(typesField)}`
      )
    }
  }

  if (!useSrcJsLayout) {
    if (existsSync(EMIT_TYPES_CONFIG)) {
      pass(`${EMIT_TYPES_CONFIG} існує`)
      let raw
      try {
        raw = JSON.parse(await readFile(EMIT_TYPES_CONFIG, 'utf8'))
      } catch {
        fail(`${EMIT_TYPES_CONFIG}: некоректний JSON`)
        raw = null
      }
      if (raw) {
        const issues = emitTypesConfigIssues(raw)
        if (issues.length === 0) {
          pass(`${EMIT_TYPES_CONFIG}: compilerOptions придатні для emitDeclarationOnly → types/`)
        } else {
          fail(`${EMIT_TYPES_CONFIG}: ${issues.join('; ')}`)
        }
      }
    } else {
      fail(
        `Без .js під npm/src потрібен ${EMIT_TYPES_CONFIG} (див. npm-module.mdc: emit через tsconfig, без штучного src/index.js)`
      )
    }
  }

  const hk = await readHkConfig()
  if (hk) {
    pass(`${hk.path} існує`)
    const missing = useSrcJsLayout ? missingHkSrcLayoutFragments(hk.text) : missingHkEmitTypesConfigFragments(hk.text)
    if (missing.length === 0) {
      pass(
        `${hk.path}: pre-commit містить очікуваний виклик tsc (${useSrcJsLayout ? 'layout src' : 'tsconfig emit-types'})`
      )
    } else {
      fail(`${hk.path}: онови pre-commit крок (npm-module.mdc); не знайдено: ${missing.join(', ')}`)
    }
  } else {
    fail('Очікується hk.pkl або .config/hk.pkl з pre-commit і tsc (npm-module.mdc)')
  }

  if (existsSync('.github/workflows')) {
    pass('.github/workflows/ існує')
  } else {
    fail('.github/workflows/ не існує')
  }

  const publishWf = '.github/workflows/npm-publish.yml'
  if (existsSync(publishWf)) {
    pass(`${publishWf} існує`)
    const pub = await readFile(publishWf, 'utf8')
    const root = parseWorkflowYaml(pub)

    if (root) {
      if (pushPathsIncludeNpmGlob(root)) {
        pass(`${publishWf}: on.push.paths містить npm/**`)
      } else {
        fail(`${publishWf}: у on.push.paths має бути npm/**`)
      }
      if (pushHasMainBranch(root)) {
        pass(`${publishWf}: очікується branch main`)
      } else {
        fail(`${publishWf}: очікується branch main`)
      }
      if (hasIdTokenWritePermission(root)) {
        pass(`${publishWf}: permissions містить id-token: write (OIDC)`)
      } else {
        fail(`${publishWf}: permissions має містити id-token: write (OIDC)`)
      }
      if (hasNpmPublishStepWithPackage(root)) {
        pass(`${publishWf}: uses JS-DevTools/npm-publish та with.package npm/package.json`)
      } else {
        fail(`${publishWf}: очікується uses: JS-DevTools/npm-publish та with.package: npm/package.json`)
      }
    } else {
      const need = [
        { sub: 'npm/**', msg: `${publishWf}: у on.push.paths має бути npm/**` },
        { sub: 'branches:', msg: `${publishWf}: очікується on.push.branches` },
        { sub: 'main', msg: `${publishWf}: очікується branch main` },
        { sub: 'id-token: write', msg: `${publishWf}: permissions має містити id-token: write (OIDC)` },
        { sub: 'JS-DevTools/npm-publish', msg: `${publishWf}: очікується uses: JS-DevTools/npm-publish` },
        { sub: 'package: npm/package.json', msg: `${publishWf}: with.package має бути npm/package.json` }
      ]
      for (const { sub, msg } of need) {
        if (pub.includes(sub)) {
          pass(`${publishWf} містить «${sub}»`)
        } else {
          fail(msg)
        }
      }
    }
  } else {
    fail(`Відсутній ${publishWf} (npm-module.mdc: npm publish)`)
  }

  return reporter.getExitCode()
}
