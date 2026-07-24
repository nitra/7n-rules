/**
 * Фейковий handler-модуль для тесту `case 'taze'` у `runCli` (`../n-rules-cli.test.mjs`):
 * імітує `runTazeCli`, який реально живе у плагіні `@7n/rules-lang-js` і резолвиться
 * динамічним `import(pathToFileURL(handler.modulePath).href)` за шляхом з `getHandlers`.
 */

/**
 * @param {string[]} args сирі аргументи після `taze`
 * @returns {Promise<number>} завжди 0 — фіксує факт виклику через `globalThis`
 */
export async function runTazeCli(args) {
  globalThis.__fakeTazeCliCalls = globalThis.__fakeTazeCliCalls ?? []
  globalThis.__fakeTazeCliCalls.push(args)
  return 0
}
