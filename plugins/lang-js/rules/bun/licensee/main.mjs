/**
 * lint-поверхня bun/licensee: read-only detector ліцензій npm-залежностей (`licensee`).
 * Генерація дефолтного `.licensee.json` — окремий T0-fix (`fix-licensee.mjs`), не в detector-і.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'
import { resolveCmd } from '@7n/rules/scripts/utils/resolve-cmd.mjs'
import { spawnAsync } from '@7n/rules/scripts/utils/spawn-async.mjs'

/** `Terms:`-значення, яким `licensee` позначає власний пакет без валідного SPDX у `license` (не сторонню ліцензію). */
const INVALID_METADATA_TERMS = 'Invalid license metadata'

/** Роздільник блоків одного пакета у `--errors-only` stdout `licensee` (порожній рядок). */
const BLOCK_SEPARATOR_RE = /\n\s*\n/u

/**
 * Розбиває `--errors-only` stdout `licensee` на блоки одного пакета (розділені порожнім
 * рядком): перший рядок — `name@version` (scoped `@scope/name@version` теж), далі —
 * `  Terms: <SPDX або "Invalid license metadata">` серед інших полів.
 * @param {string} stdout сирий stdout `licensee --errors-only`
 * @returns {Array<{ name: string, terms: string, block: string }>} розібрані блоки
 */
function parseLicenseeBlocks(stdout) {
  return stdout
    .split(BLOCK_SEPARATOR_RE)
    .map(b => b.trim())
    .filter(Boolean)
    .map(block => {
      const lines = block.split('\n')
      const header = lines[0].trim()
      const termsLine = lines.find(l => l.trim().startsWith('Terms:'))
      const terms = termsLine ? termsLine.split('Terms:', 2)[1].trim() : ''
      const atIdx = header.lastIndexOf('@')
      const name = atIdx > 0 ? header.slice(0, atIdx) : header
      return { name, terms, block }
    })
    .filter(b => b.name.length > 0)
}

/**
 * Detector bun/licensee: ліцензії npm-залежностей через `licensee` (read-only).
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст lint-прогону
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} результат detector-а
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter
  const cwd = ctx.cwd

  const configPath = join(cwd, '.licensee.json')
  if (!existsSync(configPath)) {
    fail(
      'lint-bun: licensee — немає .licensee.json; запустіть `npx @7n/rules lint bun` локально для генерації (bun.mdc)',
      'licensee-config-missing'
    )
    return reporter.result()
  }

  const bun = resolveCmd('bun')
  if (!bun) {
    fail('lint-bun: `bun` не знайдено в PATH (bun.mdc)', 'bun-missing')
    return reporter.result()
  }

  // Без --quiet: `licensee` пише реальні NOT APPROVED записи (name/version/license) у
  // stdout через print() — деталь замість голого "код 1". Crash/die() усередині
  // самого тула (invalid config, внутрішній виняток на кшталт "Cannot read properties
  // of undefined (reading 'localeCompare')" — спостережено з @npmcli/arborist на
  // bun-based node_modules) завжди йде у stderr через die(); легітимний звіт про
  // порушення — лише у stdout. Канал розрізняє crash від реального порушення.
  const r = await spawnAsync(bun, ['x', 'licensee', '--production', '--errors-only'], { cwd, shell: false })
  if (r.exitCode !== 0) {
    const stderr = (r.stderr ?? '').trim().slice(0, 2000)
    if (stderr) {
      // Crash самого тула — НЕ підтверджене ліцензійне порушення: fail-open
      // діагностикою (не блокує CI-гейт). Fail-closed тут перманентно червонив би
      // bun-монорепо: @npmcli/arborist (яким licensee читає node_modules)
      // несумісний із деревом bun install.
      const result = reporter.result()
      result.diagnostics = [
        {
          level: 'warn',
          message:
            `lint-bun: licensee — інструмент завершився з помилкою, це НЕ підтверджене ліцензійне порушення ` +
            `(код ${r.exitCode}, bun.mdc). Ймовірна причина — несумісність @npmcli/arborist з деревом bun install. ` +
            `Перевір вручну: \`bunx licensee --production\`.\n${stderr}`
        }
      ]
      return result
    }
    const stdout = (r.stdout ?? '').trim()
    const blocks = parseLicenseeBlocks(stdout)
    const metadataBlocks = blocks.filter(b => b.terms === INVALID_METADATA_TERMS)
    const thirdPartyBlocks = blocks.filter(b => b.terms !== INVALID_METADATA_TERMS)

    // Розділяємо на дві причини: `license-metadata-invalid` (власний пакет workspace без
    // валідного SPDX у `license` — детермінований T0-фікс) і `license-violation` (реальна
    // заборонена стороння ліцензія — потребує людського рішення про policy). Якщо блоки
    // не розібрались (формат `licensee` змінився) — fallback на старий агрегований
    // `license-violation` з повним stdout, щоб не втратити сигнал про порушення.
    if (blocks.length === 0) {
      const detail = stdout ? `\n${stdout.slice(0, 2000)}` : ''
      fail(`lint-bun: licensee — порушення ліцензій (код ${r.exitCode}, bun.mdc)${detail}`, 'license-violation')
    } else {
      for (const b of metadataBlocks) {
        fail(`lint-bun: licensee — ${b.name}: Invalid license metadata (bun.mdc)`, {
          reason: 'license-metadata-invalid',
          data: { package: b.name }
        })
      }
      if (thirdPartyBlocks.length > 0) {
        const detail = thirdPartyBlocks
          .map(b => b.block)
          .join('\n\n')
          .slice(0, 2000)
        fail(`lint-bun: licensee — порушення ліцензій (код ${r.exitCode}, bun.mdc)\n${detail}`, 'license-violation')
      }
    }
  }
  return reporter.result()
}
