// cspell:ignore непортованим
import { describe, expect, test } from 'vitest'
import { spawn } from 'node:child_process'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { env, execPath } from 'node:process'
import { fileURLToPath } from 'node:url'

import { BRIDGE_PROTOCOL_VERSION } from '../bridge-host.mjs'
import { withTmpDir } from '../../../utils/test-helpers.mjs'

/**
 * Гейт операції `ensureTool` ЗВОРОТНОГО МОСТУ — того єдиного шляху, яким
 * `n-rules tools ensure` добуває тули з GitHub Releases (мінідизайн
 * `docs/specs/2026-08-04-tools-ensure-design.md`, розділ 4: другої реалізації
 * завантаження в Rust не заводиться, поки JS-`ensureToolAsync` усе одно
 * потрібен непортованим споживачам).
 *
 * Тест ганяє РЕАЛЬНИЙ `bridge-host.mjs` через unix-сокет тим самим протоколом,
 * що й Rust-бік, але без мережі: тул «уже встановлено» в керованому кеші
 * (`N_CURSOR_TOOL_CACHE_DIR`) при порожньому `PATH`, тож `ensureToolAsync`
 * доходить лише до кроку 2 і повертає шлях. Так перевіряється саме ПРОВОДКА
 * (протокол, версія, форма відповіді, обробка помилки), а не завантаження.
 */

const HOST = join(dirname(fileURLToPath(import.meta.url)), '..', 'bridge-host.mjs')

/**
 * Піднімає `bridge-host.mjs` на тимчасовому сокеті, шле запити по черзі й
 * повертає відповіді. Сокет свідомо короткий і в `/tmp` — `sun_path`
 * обмежений 104 байтами на macOS (той самий мотив, що в Rust-боці).
 * @param {object[]} requests запити протоколу (без `id`)
 * @param {Record<string, string>} extraEnv додаткові змінні для дочірнього процесу
 * @returns {Promise<object[]>} відповіді у порядку запитів
 */
async function callBridge(requests, extraEnv) {
  const socketPath = `/tmp/n-rules-bridge-test-${process.pid}-${Date.now().toString(16)}.sock`
  const responses = []
  // Обгортка event-emitter API (net.createServer): проміс будується навколо
  // колбеків 'data'/'error', async/await їх не замінює.
  // oxlint-disable-next-line promise/avoid-new
  await new Promise((resolve, reject) => {
    const server = createServer(socket => {
      let buffer = ''
      let next = 0
      const send = () => socket.write(`${JSON.stringify({ id: next + 1, ...requests[next] })}\n`)
      socket.on('data', chunk => {
        buffer += chunk.toString('utf8')
        let nl = buffer.indexOf('\n')
        while (nl !== -1) {
          responses.push(JSON.parse(buffer.slice(0, nl)))
          buffer = buffer.slice(nl + 1)
          next += 1
          if (next < requests.length) send()
          else socket.end()
          nl = buffer.indexOf('\n')
        }
      })
      send()
    })
    server.listen(socketPath, () => {
      const child = spawn(execPath, [HOST, socketPath], {
        env: { ...env, ...extraEnv },
        stdio: 'inherit'
      })
      child.on('exit', () => {
        server.close()
        resolve()
      })
      child.on('error', reject)
    })
  })
  return responses
}

/**
 * Готує «встановлений» тул у керованому кеші й порожній каталог для `PATH`.
 * @param {string} dir tmp-каталог
 * @param {string} toolId ідентифікатор тула
 * @returns {{ cacheDir: string, emptyBin: string, toolPath: string }} шляхи фікстури
 */
function fakeCachedTool(dir, toolId) {
  const cacheDir = join(dir, 'cache')
  const emptyBin = join(dir, 'empty-bin')
  mkdirSync(cacheDir, { recursive: true })
  mkdirSync(emptyBin, { recursive: true })
  const toolPath = join(cacheDir, toolId)
  writeFileSync(toolPath, '#!/bin/sh\nexit 0\n', 'utf8')
  chmodSync(toolPath, 0o755)
  return { cacheDir, emptyBin, toolPath }
}

describe('bridge-host: операція ensureTool', () => {
  test('hello віддає ту саму версію протоколу, що звіряє Rust', async () => {
    const [hello] = await callBridge([{ op: 'hello' }], {})
    expect(hello.ok).toBe(true)
    expect(hello.result.protocol).toBe(BRIDGE_PROTOCOL_VERSION)
  })

  test('повертає шлях до вже добутого тула (крок «керований кеш»)', async () => {
    await withTmpDir(async dir => {
      const { cacheDir, emptyBin, toolPath } = fakeCachedTool(dir, 'kubeconform')
      const [response] = await callBridge([{ op: 'ensureTool', toolId: 'kubeconform' }], {
        N_CURSOR_TOOL_CACHE_DIR: cacheDir,
        PATH: emptyBin
      })
      expect(response.ok).toBe(true)
      expect(response.result.path).toBe(toolPath)
    })
  })

  test('без toolId — помилка операції, а не мовчазний успіх', async () => {
    const [response] = await callBridge([{ op: 'ensureTool' }], {})
    expect(response.ok).toBe(false)
    expect(response.error).toContain('toolId')
  })

  test('невідомий тул — помилка з реєстру, прогін не «зеленіє»', async () => {
    await withTmpDir(async dir => {
      const { cacheDir, emptyBin } = fakeCachedTool(dir, 'kubeconform')
      const [response] = await callBridge([{ op: 'ensureTool', toolId: 'no-such-tool' }], {
        N_CURSOR_TOOL_CACHE_DIR: cacheDir,
        PATH: emptyBin
      })
      expect(response.ok).toBe(false)
      expect(response.error).toContain('no-such-tool')
    })
  })
})
