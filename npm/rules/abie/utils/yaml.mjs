/**
 * Спільні YAML-хелпери для abie-перевірок: парсинг документів з опційним modeline,
 * BOM-strip, regex для `# yaml-language-server: $schema=` і поділу на рядки.
 */
import { readFile } from 'node:fs/promises'

import { parseAllDocuments } from 'yaml'

export const MODELINE_RE = /^#\s*yaml-language-server:\s*\$schema=(\S+)\s*$/
export const LINE_SPLIT_RE = /\r?\n/u

/**
 * Прибирає BOM на початку файлу.
 * @param {string} s вміст
 * @returns {string}
 */
export function stripBom(s) {
  return s.startsWith('﻿') ? s.slice(1) : s
}

/**
 * Чи YAML-документ — це `kind: Deployment`.
 * @param {unknown} obj корінь YAML-документа
 * @returns {boolean}
 */
export function isDeploymentDoc(obj) {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    !Array.isArray(obj) &&
    /** @type {Record<string, unknown>} */ (obj).kind === 'Deployment'
  )
}

/**
 * No-op fail-handler для функцій, що мовчки повертають null/[] при помилці парсингу.
 * @param {string} _msg ігнорується
 */
export const silentFail = _msg => {
  /* silent — пошкоджені файли ловить check-k8s */
}

/**
 * Зчитує і парсить YAML-документи з файлу. BOM і modeline (перший рядок `$schema`)
 * автоматично прибираються перед `parseAllDocuments`. При помилці читання/парсингу
 * викликає `failFn` і повертає `null`.
 * @param {string} abs абсолютний шлях
 * @param {string} rel відносний (для повідомлень)
 * @param {(msg: string) => void} failFn
 * @returns {Promise<import('yaml').Document[] | null>}
 */
export async function readAndParseYamlDocs(abs, rel, failFn) {
  let raw
  try {
    raw = await readFile(abs, 'utf8')
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    failFn(`${rel}: не вдалося прочитати (${msg})`)
    return null
  }
  const body = stripBom(raw)
  const lines = body.split(LINE_SPLIT_RE)
  const first = lines[0] ?? ''
  const rest = MODELINE_RE.test(first.trim()) ? lines.slice(1).join('\n') : body
  try {
    return parseAllDocuments(rest)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    failFn(`${rel}: YAML (${msg})`)
    return null
  }
}
