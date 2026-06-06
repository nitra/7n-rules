/**
 * Експеримент n-fix: вносить ДЕТЕРМІНОВАНИЙ набір порушень у корінь репо, щоб
 * `n-cursor fix` мав що чинити. Відтворюваний (однаковий результат щоразу), щоб A і B
 * стартували з ідентичного стану. Відкат — у restore.mjs.
 *
 * Запуск: node npm/exp/break.mjs   (з кореня репо)
 */
import { existsSync } from 'node:fs'
import { rm, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()

// 1. Заборонені lockfiles (bun-правило).
await writeFile(join(root, 'yarn.lock'), '# injected by experiment\n', 'utf8')
await writeFile(join(root, 'package-lock.json'), '{}\n', 'utf8')

// 2. Видалити .vscode/extensions.json (якщо є — деякі правила вимагають його наявності).
const vscodeExt = join(root, '.vscode/extensions.json')
if (existsSync(vscodeExt)) await rm(vscodeExt)

// 3. Прибрати script із кореневого package.json (перевіримо, чи правило це ловить).
const pkgPath = join(root, 'package.json')
const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
if (pkg.scripts?.['lint-text']) {
  delete pkg.scripts['lint-text']
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
}

console.log('injected: yarn.lock, package-lock.json, removed .vscode/extensions.json, removed scripts.lint-text')
