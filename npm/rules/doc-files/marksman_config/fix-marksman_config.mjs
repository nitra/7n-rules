/**
 * T0-autofix для `doc-files/marksman_config` — копіює canonical baseline `.marksman.toml` без LLM.
 *
 * Константи дубльовані з native-порту detector-а (`crates/rules-core/src/concerns/marksman_config.rs`),
 * а не імпортуються з `main.mjs` — detector портований у Rust (F1 фази 5 батчу 2), а `main.mjs`
 * видалений (F2 фази 5 батчу 2). T0-фіксер лишається JS (копіювання файлу з canonical baseline
 * поза native-поверхнею).
 */
import { existsSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** Абсолютний шлях до канонічного baseline-конфігу marksman, що постачається разом із пакетом правил. */
const MARKSMAN_BASELINE_PATH = join(HERE, 'data', 'marksman_config', 'marksman.baseline.toml')
/** Імʼя конфіг-файлу marksman, який має лежати в корені репозиторію. */
const MARKSMAN_TARGET_FILENAME = '.marksman.toml'

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'doc-files-marksman-config-missing',
    test: violations => violations.some(v => v.data?.kind === 'marksman-config-missing'),
    apply: async (_violations, ctx) => {
      // Install-sanity-guard (успадкований від видаленого main.mjs): baseline постачається
      // в пакеті, його відсутність — зламана інсталяція @7n/rules, а не стан репо.
      if (!existsSync(MARKSMAN_BASELINE_PATH)) {
        throw new Error(
          `canonical baseline відсутній у пакеті (${MARKSMAN_BASELINE_PATH}) — ` +
            'інсталяція @7n/rules пошкоджена, перевстанови пакет (doc-files.mdc)'
        )
      }
      const target = join(ctx.cwd, MARKSMAN_TARGET_FILENAME)
      ctx.recordWrite?.(target)
      await copyFile(MARKSMAN_BASELINE_PATH, target)
      return {
        touchedFiles: [target],
        message: `${MARKSMAN_TARGET_FILENAME} створено з canonical baseline (doc-files.mdc)`
      }
    }
  }
]
