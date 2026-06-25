/** @see ./docs/t0.md */
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { runConformanceCheck } from './run-conformance-check.mjs'
import { writeChange } from '../../../rules/release/change.mjs'

const REC_REQUIRE_RE = /recommendations має містити "[^"]+"/
const REC_MATCH_ALL_RE = /recommendations має містити "([^"]+)"/g
const FORBIDDEN_FILE_RE = /Знайдено заборонений файл: \S+/
const FORBIDDEN_FILE_MATCH_ALL_RE = /Знайдено заборонений файл: (\S+)/g
// Конформність changelog: «<ws>: є релевантні зміни, але немає change-файлу».
const MISSING_CHANGE_RE = /є релевантні зміни, але немає change-файлу/
const MISSING_CHANGE_MATCH_ALL_RE = /(?:^|\s)([\w./@-]+): є релевантні зміни, але немає change-файлу/gm
/** Дефолти autofix-створеного change-файлу (узгоджено з n-changelog.mdc / consistency.mjs). */
const CHANGE_BUMP = 'patch'
const CHANGE_SECTION = 'Changed'
const CHANGE_FALLBACK_MESSAGE = 'оновлення'

/**
 * Опис для авто-створеного change-файлу: subject останнього коміту, інакше fallback.
 * @param {string} cwd корінь репозиторію
 * @returns {string} непорожній опис
 */
function autoChangeMessage(cwd) {
  const r = spawnSync('git', ['log', '-1', '--format=%s'], { cwd, encoding: 'utf8' })
  const subject = r.status === 0 ? (r.stdout ?? '').trim() : ''
  return subject || CHANGE_FALLBACK_MESSAGE
}

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
    test: out => REC_REQUIRE_RE.test(out),
    apply: (out, cwd) => {
      const matches = [...out.matchAll(REC_MATCH_ALL_RE)]
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
    test: out => FORBIDDEN_FILE_RE.test(out),
    apply: (out, cwd) => {
      const matches = [...out.matchAll(FORBIDDEN_FILE_MATCH_ALL_RE)]
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
  },

  // ── changelog-create-change-file ─────────────────────────────────────────────
  // Violation: «<ws>: є релевантні зміни, але немає change-файлу»
  // Fix: створити change-файл через канонічну `writeChange` (без LLM) — той самий
  // механізм, що autofix changelog-конформності. Прибирає ескалацію в хмару на цьому кейсі.
  {
    id: 'changelog-create-change-file',
    test: out => MISSING_CHANGE_RE.test(out),
    apply: async (out, cwd) => {
      const workspaces = Array.from(out.matchAll(MISSING_CHANGE_MATCH_ALL_RE), m => m[1])
      if (workspaces.length === 0) return { ok: false, action: 'no match' }

      const message = autoChangeMessage(cwd)
      const created = []
      for (const ws of workspaces) {
        try {
          const rel = await writeChange({ bump: CHANGE_BUMP, section: CHANGE_SECTION, message, ws, cwd })
          created.push(ws === '.' ? rel : join(ws, rel))
        } catch (error) {
          return { ok: false, action: `writeChange ${ws}: ${error.message}` }
        }
      }
      return { ok: true, action: `створено change-файл (${CHANGE_BUMP}/${CHANGE_SECTION}): ${created.join(', ')}` }
    }
  },

  // ── bun-bunfig-create ────────────────────────────────────────────────────────
  // Violation: «Відсутній bunfig.toml — створи з [install] linker = "hoisted"»
  // Fix: створити bunfig.toml з канонічним вмістом (bun.mdc)
  {
    id: 'bun-bunfig-create',
    test: out => /Відсутній bunfig\.toml/.test(out),
    apply: (_out, cwd) => {
      const target = join(cwd, 'bunfig.toml')
      if (existsSync(target)) return { ok: false, action: 'bunfig.toml вже існує' }
      writeFileSync(target, '[install]\nlinker = "hoisted"\n', 'utf8')
      return { ok: true, action: 'створено bunfig.toml' }
    }
  },

  // ── bun-yarn-dir-remove ──────────────────────────────────────────────────────
  // Violation: «Знайдено директорію .yarn — видали її»
  // Fix: рекурсивно видалити .yarn/
  {
    id: 'bun-yarn-dir-remove',
    test: out => /Знайдено директорію \.yarn/.test(out),
    apply: (_out, cwd) => {
      const target = join(cwd, '.yarn')
      if (!existsSync(target)) return { ok: false, action: '.yarn не знайдено' }
      rmSync(target, { recursive: true, force: true })
      return { ok: true, action: 'видалено .yarn/' }
    }
  },

  // ── style-stylelintignore-create ─────────────────────────────────────────────
  // Violation: «.stylelintignore не існує — створи з вмістом: dist/»
  // Fix: створити .stylelintignore з рядком dist/
  {
    id: 'style-stylelintignore-create',
    test: out => /\.stylelintignore не існує/.test(out),
    apply: (_out, cwd) => {
      writeFileSync(join(cwd, '.stylelintignore'), 'dist/\n', 'utf8')
      return { ok: true, action: 'створено .stylelintignore' }
    }
  },

  // ── style-stylelintignore-dist-add ───────────────────────────────────────────
  // Violation: «.stylelintignore не містить рядка dist/»
  // Fix: дописати dist/ до існуючого .stylelintignore
  {
    id: 'style-stylelintignore-dist-add',
    test: out => /\.stylelintignore не містить рядка dist\//.test(out),
    apply: (_out, cwd) => {
      const target = join(cwd, '.stylelintignore')
      appendFileSync(target, '\ndist/\n', 'utf8')
      return { ok: true, action: 'додано dist/ до .stylelintignore' }
    }
  },

  // ── style-pkg-stylelint-add ──────────────────────────────────────────────────
  // Violation: «Немає конфігу stylelint — додай "stylelint": {...} до package.json»
  // Fix: додати поле stylelint до кореневого package.json
  {
    id: 'style-pkg-stylelint-add',
    test: out => /Немає конфігу stylelint/.test(out),
    apply: (_out, cwd) => {
      const pkgPath = join(cwd, 'package.json')
      if (!existsSync(pkgPath)) return { ok: false, action: 'package.json не знайдено' }
      let pkg
      try {
        pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      } catch {
        return { ok: false, action: 'package.json: невалідний JSON' }
      }
      if (pkg.stylelint) return { ok: false, action: 'stylelint вже є в package.json' }
      pkg.stylelint = { extends: '@nitra/stylelint-config' }
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
      return { ok: true, action: 'додано stylelint до package.json' }
    }
  },

  // ── js-run-jsconfig-create ───────────────────────────────────────────────────
  // Violation: «[packages/api] є каталог src/, але немає jsconfig.json»
  // Fix: для кожного воркспейсу з violation створити канонічний jsconfig.json
  // (NodeNext + include: src/**/*; шаблон: js-run/policy/jsconfig/template/)
  {
    id: 'js-run-jsconfig-create',
    test: out => /є каталог src\/, але немає jsconfig\.json/.test(out),
    apply: (out, cwd) => {
      const RE = /\[([^\]]+)\] є каталог src\/, але немає jsconfig\.json/gu
      const matches = [...out.matchAll(RE)]
      if (matches.length === 0) return { ok: false, action: 'no match' }
      const canonical =
        JSON.stringify(
          {
            compilerOptions: {
              lib: ['esnext'],
              module: 'NodeNext',
              moduleResolution: 'NodeNext',
              target: 'esnext',
              checkJs: false
            },
            include: ['src/**/*']
          },
          null,
          2
        ) + '\n'
      const created = []
      for (const m of matches) {
        const ws = m[1]
        const target = join(cwd, ws, 'jsconfig.json')
        if (!existsSync(target)) {
          writeFileSync(target, canonical, 'utf8')
          created.push(ws)
        }
      }
      if (created.length === 0) return { ok: false, action: 'jsconfig.json вже існує в усіх воркспейсах' }
      return { ok: true, action: `створено jsconfig.json: ${created.join(', ')}` }
    }
  }
]

/**
 * Застосовує всі T0-auto паттерни до одного violation-output.
 * @param {string} ruleId id правила (для логу)
 * @param {string} violationOutput рядок з поля `output` у `fix --json`
 * @param {string} cwd корінь проєкту
 * @returns {Promise<{ applied: boolean, actions: string[] }>} результат: чи щось застосовано і список дій
 */
export async function applyT0Auto(ruleId, violationOutput, cwd) {
  const actions = []
  let applied = false

  for (const p of PATTERNS) {
    if (!p.test(violationOutput)) continue
    // Патерн може бути sync ({ok,action}) або async (Promise) — await нормалізує обидва.
    const result = await p.apply(violationOutput, cwd)
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
 * @param {{ ruleId: string, output: string }[]} failedRules повний список правил із output
 * @returns {string[]} ID правил із наявним T0-auto патерном
 */
export function filterT0AutoRules(failedRules) {
  return failedRules.filter(r => PATTERNS.some(p => p.test(r.output))).map(r => r.ruleId)
}

// ─── CLI entry-point ──────────────────────────────────────────────────────────

/**
 * Застосовує T0-auto до кожного провального правила, розділяючи на applied/skipped.
 * @param {Array<{ ruleId: string, output: string }>} failed провальні правила
 * @param {string} cwd корінь проєкту
 * @returns {Promise<{ applied: Array<{ ruleId: string, actions: string[] }>, skipped: string[] }>} застосовані й пропущені
 */
async function applyT0ToFailed(failed, cwd) {
  const applied = []
  const skipped = []
  for (const r of failed) {
    const result = await applyT0Auto(r.ruleId, r.output, cwd)
    if (result.applied) {
      applied.push({ ruleId: r.ruleId, actions: result.actions })
    } else {
      skipped.push(r.ruleId)
    }
  }
  return { applied, skipped }
}

/**
 * CLI підкоманда `n-cursor fix-t0 [rule...]`.
 * Запускає `fix --json`, застосовує T0-auto для кожного violation,
 * повторно перевіряє check-gate, виводить підсумок.
 * @param {string[]} args аргументи (опційний список rule-ids)
 * @param {string}   cwd  корінь проєкту
 * @returns {Promise<number>} 0 — T0-auto закрив всі або немає порушень; 1 — лишились
 */
export async function runT0AutoCli(args, cwd) {
  const ruleFilter = args.filter(a => !a.startsWith('--'))
  const verbose = args.includes('--verbose') || args.includes('-v')

  // 1. Конформність-детект (пряма функція, без subprocess)
  const fixJson = await runConformanceCheck(ruleFilter, cwd)
  const failed = fixJson.rules.filter(r => !r.ok)
  if (failed.length === 0) {
    console.log(`✅ fix-t0: всі правила чисті — T0 не потрібен`)
    return 0
  }

  // 2. Застосувати T0-auto
  const { applied, skipped } = await applyT0ToFailed(failed, cwd)

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
  const recheckJson = await runConformanceCheck(
    applied.map(a => a.ruleId),
    cwd
  )
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
