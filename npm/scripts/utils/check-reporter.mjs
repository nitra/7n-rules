/**
 * Спільний репортер для check-скриптів і lint-docker.
 *
 * Об’єднує вивід успіхів (`pass` з `pass.mjs`) і помилок з префіксом ❌; накопичує код виходу **1**,
 * якщо хоча б раз викликано `fail`.
 *
 * Використовуй `getExitCode()` у `return`, а не деструктуризацію `exitCode` — геттер «знімається» один раз.
 */
import { pass } from './pass.mjs'

/**
 * Створює пару `pass` / `fail` з накопиченням ненульового коду виходу.
 * @returns {{ pass: typeof pass, fail: (msg: string) => void, getExitCode: () => number }}
 */
export function createCheckReporter() {
  let exitCode = 0
  return {
    pass,
    fail(msg) {
      console.log(`  ❌ ${msg}`)
      exitCode = 1
    },
    getExitCode() {
      return exitCode
    }
  }
}
