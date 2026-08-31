/**
 * Фейковий handler-модуль для тесту `case 'taze'` у `runCli` (`../n-rules-cli.test.mjs`):
 * імітує handler `@7n/rules-lang-js`, який реально резолвиться динамічним
 * `import(pathToFileURL(contribution.resourcePath).href)` за шляхом contribution-у
 * `taze.provider@1` з id `taze-js`. Named export `runTazeCli` покриває `taze diff`;
 * default export (`EcosystemProvider`-подібний обʼєкт) покриває `taze backup`/`cleanup`.
 */

/** @type {string[][]} */
const calls = []

/** @type {Array<{ verb: 'backup' | 'cleanup', cwd: string, manifests: string[] }>} */
const providerCalls = []

/**
 * @returns {string[][]} усі виклики `runTazeCli` цього фікстур-модуля (для перевірки в тесті)
 */
export function getFakeTazeCliCalls() {
  return calls
}

/**
 * @returns {Array<{ verb: 'backup' | 'cleanup', cwd: string, manifests: string[] }>} усі виклики `backup`/`cleanup` default-провайдера
 */
export function getFakeTazeProviderCalls() {
  return providerCalls
}

/**
 * @param {string[]} args сирі аргументи після `taze`
 * @returns {number} завжди 0 — фіксує факт виклику у `calls`
 */
export function runTazeCli(args) {
  calls.push(args)
  return 0
}

/** Фейковий `EcosystemProvider` — лише поля, потрібні гілкам `backup`/`cleanup` у `n-rules-cli.mjs`. */
export default {
  detect: () => ['package.json'],
  backup(cwd, manifests) {
    providerCalls.push({ verb: 'backup', cwd, manifests })
    return Promise.resolve()
  },
  cleanup(cwd, manifests) {
    providerCalls.push({ verb: 'cleanup', cwd, manifests })
    return Promise.resolve()
  }
}
