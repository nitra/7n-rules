/**
 * T0-auto: детермінований рівень виправлень для n-fix оркестратора.
 *
 * Парсить `output` з `n-cursor fix --json` → застосовує програмний фікс без LLM.
 * Умова застосування: violation-message містить конкретне цільове значення
 * (назву файлу, рядок для вставки, ім'я залежності), яке можна видобути regex.
 *
 * Ієрархія: T0 (rm/create, знаний тип) → T0-auto (parse violation) → T1 (LLM).
 * T0-auto запускається першим у конвергентному циклі; T1 — лише для решти.
 *
 * Публічний API:
 *   applyT0Auto(ruleId, violationOutput, cwd) → { applied: boolean, actions: string[] }
 *   listT0AutoRules()                         → string[]  (ids що мають хоч один паттерн)
 *   runT0AutoCli(args, cwd)                   → Promise<number>  (exit 0=clean, 1=violation)
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Патерни T0-auto.
 * Кожен паттерн: {
 *   id:      string         — унікальна назва паттерну (для логу)
 *   test:    (output)=>bool — чи підходить цей output до паттерну
 *   apply:   (match, cwd)=>{ ok: bool, action: string } — застосувати фікс
 * }
 */
const PATTERNS = [
  // ── vscode-ext-add ──────────────────────────────────────────────────────────
  // Violation: «recommendations має містити "tsandall.opa"»
  // Fix: додати рядок у .vscode/extensions.json#recommendations
  {
    id: 'vscode-ext-add',
    test: out => /recommendations має містити "[^"]+"/.test(out),
    apply: (out, cwd) => {
      const matches = [...out.matchAll(/recommendations має містити "([^"]+)"/g)]
      if (matches.length === 0) return { ok: false, action: 'no match' }

      const extPath = join(cwd, '.vscode/extensions.json')
      if (!existsSync(extPath)) {
        return { ok: false, action: '.vscode/extensions.json не знайдено' }
      }

      let parsed
      try {
        parsed = JSON.parse(readFileSync(extPath, 'utf8'))
      } catch {
        return { ok: false, action: '.vscode/extensions.json: невалідний JSON' }
      }

      const recs = Array.isArray(parsed.recommendations) ? parsed.recommendations : []
      const toAdd = matches.map(m => m[1]).filter(e => !recs.includes(e))
      if (toAdd.length === 0) return { ok: false, action: 'вже є' }

      parsed.recommendations = [...recs, ...toAdd]
      writeFileSync(extPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8')
      return { ok: true, action: `додано до extensions.json: ${toAdd.join(', ')}` }
    }
  },

  // ── rm-forbidden-file ────────────────────────────────────────────────────────
  // Violation: «Знайдено заборонений файл: package-lock.json»
  // Fix: видалити файл
  {
    id: 'rm-forbidden-file',
    test: out => /Знайдено заборонений файл: \S+/.test(out),
    apply: (out, cwd) => {
      const matches = [...out.matchAll(/Знайдено заборонений файл: (\S+)/g)]
      if (matches.length === 0) return { ok: false, action: 'no match' }

      const removed = []
      for (const m of matches) {
        const filePath = join(cwd, m[1])
        if (existsSync(filePath)) {
          rmSync(filePath, { force: true })
          removed.push(m[1])
        }
      }
      if (removed.length === 0) return { ok: false, action: 'файлів не знайдено' }
      return { ok: true, action: `видалено: ${removed.join(', ')}` }
    }
  }
]

/**
 * Застосовує всі T0-auto паттерни до одного violation-output.
 *
 * @param {string} ruleId id правила (для логу)
 * @param {string} violationOutput рядок з поля `output` у `fix --json`
 * @param {string} cwd корінь проєкту
 * @returns {{ applied: boolean, actions: string[] }}
 */
export function applyT0Auto(ruleId, violationOutput, cwd) {
  const actions = []
  let applied = false

  for (const p of PATTERNS) {
    if (!p.test(violationOutput)) continue
    const result = p.apply(violationOutput, cwd)
    actions.push(`[${p.id}] ${result.action}`)
    if (result.ok) {
      applied = true
    }
  }

  return { applied, actions }
}

/**
 * Повертає список id правил, для яких є хоча б один T0-auto паттерн
 * (визначається по violation-output із `fix --json`).
 *
 * @param {{ ruleId: string, output: string }[]} failedRules
 * @returns {string[]}
 */
export function filterT0AutoRules(failedRules) {
  return failedRules.filter(r => PATTERNS.some(p => p.test(r.output))).map(r => r.ruleId)
}

// ─── CLI entry-point ──────────────────────────────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url))
/** Абсолютний шлях до npm/bin/n-cursor.js відносно цього файлу */
const N_CURSOR_BIN = join(HERE, '../../../bin/n-cursor.js')

/**
 * CLI підкоманда `n-cursor fix-t0 [rule...]`.
 * Запускає `fix --json`, застосовує T0-auto для кожного violation,
 * повторно перевіряє check-gate, виводить підсумок.
 *
 * @param {string[]} args аргументи підкоманди (опційний список rule-ids)
 * @param {string}   cwd  корінь проєкту
 * @returns {Promise<number>} 0 — T0-auto закрив всі або немає порушень; 1 — лишились
 */
export async function runT0AutoCli(args, cwd) {
  const ruleFilter = args.filter(a => !a.startsWith('--'))
  const verbose = args.includes('--verbose') || args.includes('-v')

  // 1. Запустити fix --json
  const fixResult = spawnSync('bun', [N_CURSOR_BIN, '_fix-check', ...ruleFilter], {
    cwd,
    encoding: 'utf8',
    timeout: 120_000
  })
  const raw = fixResult.stdout?.trim()
  if (!raw) {
    console.error(`n-cursor fix-t0: fix --json повернув порожній stdout`)
    console.error(fixResult.stderr?.slice(0, 300) ?? '')
    return 1
  }

  let fixJson
  try {
    fixJson = JSON.parse(raw)
  } catch {
    console.error(`n-cursor fix-t0: fix --json повернув невалідний JSON`)
    return 1
  }

  const failed = fixJson.rules.filter(r => !r.ok)
  if (failed.length === 0) {
    console.log(`✅ fix-t0: всі правила чисті — T0 не потрібен`)
    return 0
  }

  // 2. Застосувати T0-auto
  const applied = []
  const skipped = []
  for (const r of failed) {
    const result = applyT0Auto(r.ruleId, r.output, cwd)
    if (result.applied) {
      applied.push({ ruleId: r.ruleId, actions: result.actions })
    } else {
      skipped.push(r.ruleId)
    }
  }

  if (applied.length === 0) {
    console.log(`⏭️  fix-t0: T0-auto паттерн не підходить для: ${failed.map(r => r.ruleId).join(', ')}`)
    return 1
  }

  // 3. Вивести що зробили
  for (const { ruleId, actions } of applied) {
    console.log(`⚙️  ${ruleId}:`)
    for (const a of actions) console.log(`   ${a}`)
  }

  // 4. Check-gate: перевірити лише ті правила, що ми чіпали
  const recheck = spawnSync('bun', [N_CURSOR_BIN, '_fix-check', ...applied.map(a => a.ruleId)], {
    cwd,
    encoding: 'utf8',
    timeout: 120_000
  })
  const recheckRaw = recheck.stdout?.trim()
  if (!recheckRaw) {
    console.error(`fix-t0: check-gate: fix --json повернув порожній stdout`)
    return 1
  }

  const recheckJson = JSON.parse(recheckRaw)
  const stillFailed = recheckJson.rules.filter(r => !r.ok)

  if (verbose) {
    for (const r of recheckJson.rules) {
      console.log(`  ${r.ok ? '✅' : '❌'} ${r.ruleId}`)
    }
  }

  if (stillFailed.length > 0) {
    console.log(`❌ fix-t0 check-gate: ${stillFailed.map(r => r.ruleId).join(', ')} — лишились`)
    if (skipped.length > 0) {
      console.log(`⏭️  без T0 паттерну: ${skipped.join(', ')} → потрібен LLM`)
    }
    return 1
  }

  const totalFixed = applied.length
  const total = failed.length
  console.log(
    `✅ fix-t0: ${totalFixed}/${total} правил закрито T0-auto` +
      (skipped.length > 0 ? `; ${skipped.join(', ')} → T1 (LLM)` : '')
  )
  return 0
}
