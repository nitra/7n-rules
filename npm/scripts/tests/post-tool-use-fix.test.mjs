/**
 * Тести `post-tool-use-fix`: routing-функція + CLI entry.
 *
 * `routeFilePathToRules(filePath)` — чиста функція: бере відносний шлях, повертає
 * список ID правил (`npm/rules/<id>/fix.mjs`), які слід прогнати по цьому файлу.
 * Порядок маршрутів — від найбільш специфічного до загального; перший збіг — переможець.
 *
 * `runPostToolUseFixCli({ stdinJson, spawnFn })` — entry для CLI команди
 * `npx @nitra/cursor post-tool-use-fix`: парсить stdin JSON, дістає `tool_input.file_path`,
 * передає у `routeFilePathToRules` і за наявності правил spawn'ить `npx @nitra/cursor fix <rules>`.
 */
import { describe, expect, vi, test } from 'vitest'
import { EventEmitter } from 'node:events'

import { routeFilePathToRules, runPostToolUseFixCli } from '../post-tool-use-fix.mjs'

/**
 * Будує мінімальний EventEmitter-сумісний "child", що асинхронно емітить `exit`.
 * `events.once(child, 'exit')` у src отримає `[exitCode]`. Node-у `events.once`
 * вимагає інстанс EventEmitter — duck-typing не приймає.
 * @param {number} exitCode код, який емітнути в `exit`
 * @returns {EventEmitter} fake child
 */
function makeFakeChild(exitCode) {
  // eslint-disable-next-line unicorn/prefer-event-target -- node:events.once() приймає лише EventEmitter, не EventTarget
  const child = new EventEmitter()
  setImmediate(() => child.emit('exit', exitCode))
  return child
}

describe('routeFilePathToRules', () => {
  test('js/ts файли → js-lint', () => {
    expect(routeFilePathToRules('src/foo.mjs')).toEqual(['js-lint'])
    expect(routeFilePathToRules('src/foo.js')).toEqual(['js-lint'])
    expect(routeFilePathToRules('src/foo.cjs')).toEqual(['js-lint'])
    expect(routeFilePathToRules('src/foo.ts')).toEqual(['js-lint'])
    expect(routeFilePathToRules('src/foo.tsx')).toEqual(['js-lint'])
    expect(routeFilePathToRules('src/foo.jsx')).toEqual(['js-lint'])
  })

  test('vue файл → js-lint, style-lint, vue', () => {
    expect(routeFilePathToRules('src/App.vue')).toEqual(['js-lint', 'style-lint', 'vue'])
  })

  test('css/scss/sass файли → style-lint', () => {
    expect(routeFilePathToRules('src/main.css')).toEqual(['style-lint'])
    expect(routeFilePathToRules('src/main.scss')).toEqual(['style-lint'])
    expect(routeFilePathToRules('src/main.sass')).toEqual(['style-lint'])
  })

  test('yaml/yml у k8s/ → k8s', () => {
    expect(routeFilePathToRules('apps/foo/k8s/deploy.yaml')).toEqual(['k8s'])
    expect(routeFilePathToRules('apps/foo/k8s/svc.yml')).toEqual(['k8s'])
    expect(routeFilePathToRules('k8s/ns.yaml')).toEqual(['k8s'])
  })

  test('yaml/yml поза k8s/ і поза .github/ — пропустити', () => {
    expect(routeFilePathToRules('config.yaml')).toEqual([])
    expect(routeFilePathToRules('docs/some.yml')).toEqual([])
  })

  test('.github/workflows/*.yml(yaml) → ga', () => {
    expect(routeFilePathToRules('.github/workflows/ci.yml')).toEqual(['ga'])
    expect(routeFilePathToRules('.github/workflows/release.yaml')).toEqual(['ga'])
  })

  test('.rego → rego', () => {
    expect(routeFilePathToRules('policy/foo.rego')).toEqual(['rego'])
  })

  test('Dockerfile (плоский і *.Dockerfile) → docker', () => {
    expect(routeFilePathToRules('Dockerfile')).toEqual(['docker'])
    expect(routeFilePathToRules('apps/api/Dockerfile')).toEqual(['docker'])
    expect(routeFilePathToRules('build.Dockerfile')).toEqual(['docker'])
    expect(routeFilePathToRules('apps/api/api.Dockerfile')).toEqual(['docker'])
  })

  test('.sh → security', () => {
    expect(routeFilePathToRules('scripts/build.sh')).toEqual(['security'])
  })

  test('package.json → npm-module + bun', () => {
    expect(routeFilePathToRules('package.json')).toEqual(['npm-module', 'bun'])
    expect(routeFilePathToRules('apps/api/package.json')).toEqual(['npm-module', 'bun'])
  })

  test('docs/adr/**/*.md — пропустити (async normalize-decisions.sh покриває)', () => {
    expect(routeFilePathToRules('docs/adr/20260525-foo.md')).toEqual([])
    expect(routeFilePathToRules('docs/adr/nested/bar.md')).toEqual([])
  })

  test('інші .md → text', () => {
    expect(routeFilePathToRules('README.md')).toEqual(['text'])
    expect(routeFilePathToRules('docs/guide.md')).toEqual(['text'])
  })

  test('невідоме розширення — пустий масив', () => {
    expect(routeFilePathToRules('foo.xyz')).toEqual([])
    expect(routeFilePathToRules('LICENSE')).toEqual([])
  })

  test('некоректні входи — пустий масив', () => {
    expect(routeFilePathToRules('')).toEqual([])
    expect(routeFilePathToRules()).toEqual([])
    expect(routeFilePathToRules(null)).toEqual([])
    expect(routeFilePathToRules(42)).toEqual([])
  })
})

describe('runPostToolUseFixCli', () => {
  test('коли file_path → правила, спавнить `npx @nitra/cursor fix <rules>` і повертає його код', async () => {
    const spawnFn = vi.fn(() => makeFakeChild(0))
    const stdinJson = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'src/foo.mjs' } })
    const code = await runPostToolUseFixCli({ stdinJson, spawnFn })
    expect(code).toBe(0)
    expect(spawnFn).toHaveBeenCalledTimes(1)
    const [cmd, args] = spawnFn.mock.calls[0]
    expect(cmd).toBe('npx')
    expect(args).toEqual(['--no', '@nitra/cursor', 'fix', 'js-lint'])
  })

  test('коли file_path не маршрутизується (LICENSE) — exit 0, без spawn', async () => {
    const spawnFn = vi.fn(() => makeFakeChild(1))
    const stdinJson = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'LICENSE' } })
    const code = await runPostToolUseFixCli({ stdinJson, spawnFn })
    expect(code).toBe(0)
    expect(spawnFn).not.toHaveBeenCalled()
  })

  test('коли stdin порожній — exit 0, без spawn', async () => {
    const spawnFn = vi.fn(() => makeFakeChild(0))
    const code = await runPostToolUseFixCli({ stdinJson: '', spawnFn })
    expect(code).toBe(0)
    expect(spawnFn).not.toHaveBeenCalled()
  })

  test('коли stdin невалідний JSON — exit 0, без spawn', async () => {
    const spawnFn = vi.fn(() => makeFakeChild(1))
    const code = await runPostToolUseFixCli({ stdinJson: 'not-json', spawnFn })
    expect(code).toBe(0)
    expect(spawnFn).not.toHaveBeenCalled()
  })

  test('коли tool_input.file_path відсутній — exit 0, без spawn', async () => {
    const spawnFn = vi.fn(() => makeFakeChild(1))
    const stdinJson = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo' } })
    const code = await runPostToolUseFixCli({ stdinJson, spawnFn })
    expect(code).toBe(0)
    expect(spawnFn).not.toHaveBeenCalled()
  })

  test('.vue файл → spawn з трьома правилами в порядку маршруту', async () => {
    const spawnFn = vi.fn(() => makeFakeChild(0))
    const stdinJson = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'src/App.vue' } })
    await runPostToolUseFixCli({ stdinJson, spawnFn })
    const [, args] = spawnFn.mock.calls[0]
    expect(args).toEqual(['--no', '@nitra/cursor', 'fix', 'js-lint', 'style-lint', 'vue'])
  })

  test('код виходу `fix` пробрасується назовні', async () => {
    const spawnFn = vi.fn(() => makeFakeChild(2))
    const stdinJson = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'foo.mjs' } })
    const code = await runPostToolUseFixCli({ stdinJson, spawnFn })
    expect(code).toBe(2)
  })
})
