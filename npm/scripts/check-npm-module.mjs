/**
 * Перевіряє структуру npm-модуля в монорепо за правилом npm-module.mdc.
 *
 * Workspace `npm/`, `npm/package.json`, workflow `npm-publish.yml` з OIDC, `on.push.paths` з glob для каталогу npm (див. npm-module.mdc).
 * Поля workflow перевіряються після **YAML parse**, щоб не плутати з коментарями.
 */
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'

import { createCheckReporter } from './utils/check-reporter.mjs'
import {
  hasIdTokenWritePermission,
  hasNpmPublishStepWithPackage,
  parseWorkflowYaml,
  pushHasMainBranch,
  pushPathsIncludeNpmGlob
} from './utils/gha-workflow.mjs'

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
