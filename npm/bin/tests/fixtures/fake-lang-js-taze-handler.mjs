/**
 * Фейковий handler-модуль для тесту `case 'taze'` у `runCli` (`../n-rules-cli.test.mjs`):
 * імітує `runTazeCli`, який реально живе у плагіні `@7n/rules-lang-js` і резолвиться
 * динамічним `import(pathToFileURL(handler.modulePath).href)` за шляхом з `getHandlers`.
 */

/** @type {string[][]} */
const calls = []

/**
 * @returns {string[][]} усі виклики `runTazeCli` цього фікстур-модуля (для перевірки в тесті)
 */
export function getFakeTazeCliCalls() {
  return calls
}

/**
 * @param {string[]} args сирі аргументи після `taze`
 * @returns {number} завжди 0 — фіксує факт виклику у `calls`
 */
export function runTazeCli(args) {
  calls.push(args)
  return 0
}
