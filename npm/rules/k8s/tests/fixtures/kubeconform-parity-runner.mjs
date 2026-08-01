/**
 * Раннер однієї реалізації `k8s/kubeconform` в **окремому процесі** — обидві
 * гілки (JS-канон і native-порт) запускаються тут з однаковим `env`, і
 * результат друкується у stdout як JSON.
 *
 * Чому окремий процес, а не прямий виклик у тесті: під Bun
 * (`bun run --bun vitest` — канонічний CI-запуск) запис у `process.env` НЕ
 * доходить до нативного `environ`, тож Rust-бік аддона бачив би ambient-`PATH`
 * замість підставленого стаба, і parity-порівняння мовчки перевіряло б не те.
 * Env через опції `spawn` доходить до обох гілок однаково.
 *
 * Виклик: `<runtime> kubeconform-parity-runner.mjs <js|native> <rootDir>`.
 * Вивід: `{"violations": [...]}` або `{"error": "<message>"}`.
 */
import { argv, stdout } from 'node:process'

const [mode, root] = argv.slice(2)

/**
 * Зводить violation обох гілок до спільної форми: JS-репортер не проставляє
 * `severity`, коли `fail()` викликано без опцій (дефолт `error` домішує
 * `normalizeViolation` у `detect.mjs`), native-бік серіалізує його завжди.
 * @param {{ reason: string, message: string, severity?: string, file?: string }} v сире порушення
 * @returns {{ reason: string, message: string, severity: string, file: string | null }} нормалізоване
 */
function normalize(v) {
  return {
    reason: v.reason,
    message: v.message,
    severity: v.severity ?? 'error',
    file: v.file ?? null
  }
}

try {
  let violations
  if (mode === 'native') {
    const { loadNative } = await import('../../../../scripts/lib/native.mjs')
    violations = loadNative().runNativeConcern('k8s/kubeconform', root, null).violations
  } else {
    const { lint } = await import('../../kubeconform/main.mjs')
    const result = await lint({ cwd: root, ruleId: 'k8s', concernId: 'kubeconform' })
    violations = result.violations
  }
  stdout.write(JSON.stringify({ violations: violations.map(v => normalize(v)) }))
} catch (error) {
  stdout.write(JSON.stringify({ error: String(error?.message ?? error) }))
}
