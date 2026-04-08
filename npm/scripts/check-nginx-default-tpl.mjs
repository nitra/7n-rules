/**
 * Перевіряє nginx-шаблон і супутні файли за правилом nginx-default-tpl.mdc.
 *
 * Якщо в дереві є **default.conf.template**: канонічні директиви (порт 8080, /healthz, gzip_static,
 * без proxy), поруч **\*.ini** (ключі з ini мають зустрічатися в шаблоні як **$KEY**), у будь-якому
 * Dockerfile — **find** + **gzip** для каталогу `/usr/share/nginx/html` та **envsubst** з
 * **default.conf.template**. Приклад **HTTPRoute** з правила — для рев’ю; автоматична перевірка
 * вимкнена (різні схеми маршрутизації). Функція **`httpRouteMatchesNginxDefaultTpl`** лишається для
 * тестів і майбутнього вузького застосування. VSCode: **extensions.json** та **settings.json** з
 * форматером nginx і **formatOnSave**.
 *
 * У дереві від **cwd** усі **default.tpl.conf** стають **default.conf.template**: перейменування, або
 * якщо **default.conf.template** уже є — він перезаписується вмістом **default.tpl.conf**, після чого
 * **default.tpl.conf** видаляється. Якщо після міграції шаблону немає — перевірка пропускається (0).
 */
import { existsSync } from 'node:fs'
import { readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'

import { findDockerfilePaths } from './check-docker.mjs'
import { createCheckReporter } from './utils/check-reporter.mjs'
import { walkDir } from './utils/walkDir.mjs'

/**
 * Збирає абсолютні шляхи до **default.conf.template** у репозиторії; шлях `tests/fixtures` не обходиться як проєктний шаблон.
 * @param {string} root корінь cwd
 * @returns {Promise<string[]>} відсортовані абсолютні шляхи до шаблонів
 */
export async function findDefaultConfTemplatePaths(root) {
  /** @type {string[]} */
  const out = []
  await walkDir(root, p => {
    if (basename(p) !== 'default.conf.template') return
    const rel = relative(root, p).replaceAll('\\', '/')
    if (rel.includes('tests/fixtures/')) return
    out.push(p)
  })
  return out.toSorted((a, b) => a.localeCompare(b))
}

/**
 * Знаходить у дереві від `root` усі **default.tpl.conf**. Якщо поруч немає **default.conf.template** —
 * перейменовує файл; якщо є — перезаписує **default.conf.template** вмістом **default.tpl.conf** і видаляє **default.tpl.conf**.
 * @param {string} root корінь обходу (зазвичай cwd репозиторію)
 * @returns {Promise<{ renamed: string[], overwritten: string[] }>} відносні шляхи до обробленого **default.tpl.conf** (для звіту)
 */
export async function migrateDefaultTplConfFiles(root) {
  /** @type {string[]} */
  const oldPaths = []
  await walkDir(root, p => {
    if (basename(p) === 'default.tpl.conf') oldPaths.push(p)
  })
  oldPaths.sort((a, b) => a.localeCompare(b))

  /** @type {string[]} */
  const renamed = []
  /** @type {string[]} */
  const overwritten = []

  for (const oldPath of oldPaths) {
    const newPath = join(dirname(oldPath), 'default.conf.template')
    const relOld = relative(root, oldPath).replaceAll('\\', '/') || oldPath.replaceAll('\\', '/')
    if (existsSync(newPath)) {
      const body = await readFile(oldPath, 'utf8')
      await writeFile(newPath, body, 'utf8')
      await unlink(oldPath)
      overwritten.push(relOld)
    } else {
      await rename(oldPath, newPath)
      renamed.push(relOld)
    }
  }

  return { renamed, overwritten }
}

/**
 * Імена змінних з ini (рядки KEY=value, без коментарів і порожніх).
 * @param {string} iniText вміст *.ini
 * @returns {string[]} імена змінних у порядку появи
 */
export function parseIniVariableNames(iniText) {
  /** @type {string[]} */
  const keys = []
  for (const line of iniText.split(/\r?\n/u)) {
    const t = line.trim()
    if (t !== '' && !t.startsWith('#') && !t.startsWith(';')) {
      const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/u)
      if (m) keys.push(m[1])
    }
  }
  return keys
}

/**
 * Перевіряє вміст **default.conf.template** на відповідність канону з nginx-default-tpl.mdc.
 * @param {string} content текст шаблону
 * @returns {string | null} перше порушення або null
 */
export function nginxTemplateViolations(content) {
  /** @type {{ msg: string, ok: (c: string) => boolean }[]} */
  const rules = [
    { msg: 'відсутнє server_tokens off', ok: c => c.includes('server_tokens off') },
    { msg: 'відсутнє port_in_redirect off', ok: c => c.includes('port_in_redirect off') },
    { msg: 'відсутнє client_max_body_size 0', ok: c => c.includes('client_max_body_size 0') },
    { msg: 'відсутнє client_body_buffer_size 512M', ok: c => c.includes('client_body_buffer_size 512M') },
    { msg: 'відсутнє listen 8080', ok: c => c.includes('listen 8080') },
    { msg: 'відсутнє server_name _', ok: c => c.includes('server_name _') },
    { msg: 'відсутнє access_log off', ok: c => c.includes('access_log off') },
    { msg: 'відсутнє error_log off', ok: c => c.includes('error_log off') },
    { msg: 'відсутнє root /usr/share/nginx/html', ok: c => c.includes('root /usr/share/nginx/html') },
    {
      msg: 'location /healthz має повертати healthy (див. nginx-default-tpl.mdc)',
      ok: c => c.includes('/healthz') && (c.includes('healthy') || /return\s+200/u.test(c))
    },
    {
      msg: 'відсутній location для статики без gzip (gif|jpeg|png|ico|woff2|xlsx) з Cache-Control 31536000',
      ok: c =>
        c.includes('gif|jpe?g|png|ico|woff2|xlsx') &&
        c.includes('31536000') &&
        c.includes('alias /usr/share/nginx/html/')
    },
    {
      msg: 'відсутній location для svg|js|css|ttf|map|xml|webmanifest|wasm з gzip_static',
      ok: c => c.includes('svg|js|css|ttf|map|xml|webmanifest|wasm')
    },
    {
      msg: 'gzip_static on має бути принаймні двічі (два location зі стисненням)',
      ok: c => (c.match(/gzip_static\s+on/gu) ?? []).length >= 2
    },
    { msg: 'відсутнє використання $PUBLIC_PATH у location', ok: c => c.includes('$PUBLIC_PATH') },
    {
      msg: 'відсутні sendfile on; sendfile_max_chunk 512k; tcp_nopush on',
      ok: c => c.includes('sendfile on') && c.includes('sendfile_max_chunk 512k') && c.includes('tcp_nopush on')
    },
    {
      msg: 'відсутнє try_files $uri $uri/ /index.html =404',
      ok: c => c.includes('try_files $uri $uri/ /index.html =404')
    }
  ]

  for (const { msg, ok } of rules) {
    if (!ok(content)) return msg
  }

  // cspell:ignore fastcgi uwsgi
  const proxyLike =
    /\b(proxy_pass|proxy_redirect|proxy_set_header|proxy_http_version|fastcgi_pass|grpc_pass|uwsgi_pass)\b/u
  if (proxyLike.test(content)) {
    return 'знайдено proxy, gRPC або інший *_pass до бекенду — прибери з шаблону, логіку винеси в HTTPRoute (k8s) (див. nginx-default-tpl.mdc)'
  }

  return null
}

/**
 * Чи HTTPRoute відповідає патерну Exact→RequestRedirect(301, https) + PathPrefix→backendRefs:8080.
 * @param {unknown} manifest корінь YAML-документа
 * @returns {boolean} true, якщо структура збігається з прикладом у nginx-default-tpl.mdc
 */
export function httpRouteMatchesNginxDefaultTpl(manifest) {
  if (manifest === null || manifest === undefined || typeof manifest !== 'object' || Array.isArray(manifest))
    return false
  const m = /** @type {Record<string, unknown>} */ (manifest)
  if (m.kind !== 'HTTPRoute') return false
  const spec = m.spec
  if (spec === null || spec === undefined || typeof spec !== 'object' || Array.isArray(spec)) return false
  const rules = /** @type {Record<string, unknown>} */ (spec).rules
  if (!Array.isArray(rules) || rules.length < 2) return false

  const [first, second] = rules
  if (first === null || first === undefined || typeof first !== 'object' || Array.isArray(first)) return false
  if (second === null || second === undefined || typeof second !== 'object' || Array.isArray(second)) return false

  const r0 = /** @type {Record<string, unknown>} */ (first)
  const r1 = /** @type {Record<string, unknown>} */ (second)

  const matches0 = r0.matches
  const filters0 = r0.filters
  const matches1 = r1.matches
  const backends1 = r1.backendRefs

  const hasExact =
    Array.isArray(matches0) &&
    matches0.some(x => {
      if (x === null || x === undefined || typeof x !== 'object' || Array.isArray(x)) return false
      return /** @type {Record<string, unknown>} */ (x).path?.type === 'Exact'
    })

  const hasRedirect =
    Array.isArray(filters0) &&
    filters0.some(f => {
      if (f === null || f === undefined || typeof f !== 'object' || Array.isArray(f)) return false
      const fr = /** @type {Record<string, unknown>} */ (f)
      if (fr.type !== 'RequestRedirect') return false
      const rr = fr.requestRedirect
      if (rr === null || rr === undefined || typeof rr !== 'object' || Array.isArray(rr)) return false
      const red = /** @type {Record<string, unknown>} */ (rr)
      const code = red.statusCode
      const okCode = code === 301 || code === '301'
      return red.scheme === 'https' && red.path?.type === 'ReplaceFullPath' && okCode
    })

  const hasPrefix =
    Array.isArray(matches1) &&
    matches1.some(x => {
      if (x === null || x === undefined || typeof x !== 'object' || Array.isArray(x)) return false
      return /** @type {Record<string, unknown>} */ (x).path?.type === 'PathPrefix'
    })

  const has8080 =
    Array.isArray(backends1) &&
    backends1.some(b => {
      if (b === null || b === undefined || typeof b !== 'object' || Array.isArray(b)) return false
      const p = /** @type {Record<string, unknown>} */ (b).port
      return p === 8080 || p === '8080'
    })

  return hasExact && hasRedirect && hasPrefix && has8080
}

/**
 * Кожен ключ з ini має входити в шаблон як `$KEY` (envsubst).
 * @param {string[]} keys імена змінних
 * @param {string} template вміст default.conf.template
 * @returns {string | null} повідомлення або null
 */
export function iniKeysMissingInTemplate(keys, template) {
  for (const k of keys) {
    if (!template.includes(`$${k}`)) {
      return `змінна "${k}" з *.ini не використовується в шаблоні — вилучи її з ini або додай у шаблон $${k} (див. nginx-default-tpl.mdc)`
    }
  }
  return null
}

/**
 * Чи Dockerfile містить RUN із find/gzip для статики під `/usr/share/nginx/html`.
 * @param {string} dockerfileContent повний текст Dockerfile
 * @returns {boolean} true, якщо знайдено типовий крок стиснення
 */
function dockerfileHasGzipStaticPipeline(dockerfileContent) {
  const c = dockerfileContent
  return (
    /\bfind\b/u.test(c) &&
    c.includes('/usr/share/nginx/html') &&
    /\bgzip\b/u.test(c) &&
    c.includes('-k') &&
    /\*\.(?:js|css)/u.test(c)
  )
}

/**
 * Чи Dockerfile містить envsubst для **default.conf.template**.
 * @param {string} dockerfileContent повний текст Dockerfile
 * @returns {boolean} true, якщо є envsubst і посилання на шаблон
 */
function dockerfileHasEnvsSubstTemplate(dockerfileContent) {
  return dockerfileContent.includes('envsubst') && dockerfileContent.includes('default.conf.template')
}

/**
 * Перевіряє відповідність проєкту правилам nginx-default-tpl.mdc
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  const root = process.cwd()

  const { renamed: tplRenamed, overwritten: tplOverwritten } = await migrateDefaultTplConfFiles(root)
  for (const rel of tplRenamed) {
    pass(`Перейменовано default.tpl.conf → default.conf.template: ${rel}`)
  }
  for (const rel of tplOverwritten) {
    pass(`Перезаписано default.conf.template змістом default.tpl.conf: ${rel}`)
  }

  const templates = await findDefaultConfTemplatePaths(root)

  if (templates.length === 0) {
    pass('Немає default.conf.template — перевірку nginx-default-tpl пропущено')
    return reporter.getExitCode()
  }

  pass(`Знайдено default.conf.template: ${templates.length}`)

  for (const abs of templates) {
    const rel = relative(root, abs) || abs
    const content = await readFile(abs, 'utf8')
    const v = nginxTemplateViolations(content)
    if (v) {
      fail(`${rel}: ${v}`)
    } else {
      pass(`${rel}: структура шаблону узгоджена з nginx-default-tpl.mdc`)
    }

    const dir = dirname(abs)
    let iniNames = []
    try {
      const dirEntries = await readdir(dir)
      iniNames = dirEntries.filter(n => n.endsWith('.ini'))
    } catch {
      iniNames = []
    }
    if (iniNames.length === 0) {
      fail(`${rel}: поруч немає жодного *.ini — додай values-*.ini для середовищ (див. nginx-default-tpl.mdc)`)
    } else {
      pass(`${rel}: поруч є *.ini (${iniNames.length})`)
    }

    for (const iniName of iniNames) {
      const iniPath = `${dir}/${iniName}`
      const iniRel = relative(root, iniPath) || iniPath
      let iniRaw
      try {
        iniRaw = await readFile(iniPath, 'utf8')
      } catch (error) {
        fail(`${iniRel}: не вдалося прочитати (${error instanceof Error ? error.message : String(error)})`)
        iniRaw = null
      }
      if (iniRaw !== null) {
        const keys = parseIniVariableNames(iniRaw)
        const miss = iniKeysMissingInTemplate(keys, content)
        if (miss) {
          fail(`${iniRel}: ${miss}`)
        }
      }
    }
  }

  const dockerPaths = await findDockerfilePaths(root)
  if (dockerPaths.length === 0) {
    fail(
      'Є default.conf.template, але немає Dockerfile / Containerfile — додай gzip для статики та envsubst (див. nginx-default-tpl.mdc)'
    )
  } else {
    const bodies = await Promise.all(dockerPaths.map(p => readFile(p, 'utf8')))
    const gzipOk = bodies.some(body => dockerfileHasGzipStaticPipeline(body))
    const envOk = bodies.some(body => dockerfileHasEnvsSubstTemplate(body))
    if (gzipOk) {
      pass('Dockerfile: знайдено крок стиснення статики (find + gzip -k)')
    } else {
      fail('Dockerfile: потрібен RUN find … /usr/share/nginx/html … gzip -k (див. nginx-default-tpl.mdc)')
    }
    if (envOk) {
      pass('Dockerfile: знайдено envsubst для default.conf.template')
    } else {
      fail('Dockerfile: потрібен envsubst з default.conf.template (див. nginx-default-tpl.mdc)')
    }
  }

  if (existsSync('.vscode/extensions.json')) {
    const extRaw = await readFile('.vscode/extensions.json', 'utf8')
    const ext = JSON.parse(extRaw)
    if (ext.recommendations?.includes('ahmadalli.vscode-nginx-conf')) {
      pass('extensions.json містить ahmadalli.vscode-nginx-conf')
    } else {
      fail('extensions.json не містить ahmadalli.vscode-nginx-conf')
    }
  } else {
    fail('Очікується .vscode/extensions.json з ahmadalli.vscode-nginx-conf (див. nginx-default-tpl.mdc)')
  }

  if (existsSync('.vscode/settings.json')) {
    const settingsRaw = await readFile('.vscode/settings.json', 'utf8')
    const s = JSON.parse(settingsRaw)
    if (s['editor.formatOnSave'] === true) {
      pass('settings.json: editor.formatOnSave увімкнено')
    } else {
      fail('settings.json: увімкни editor.formatOnSave: true (див. nginx-default-tpl.mdc)')
    }
    if (s['[nginx]']?.['editor.defaultFormatter'] === 'ahmadalli.vscode-nginx-conf') {
      pass('settings.json: [nginx] defaultFormatter налаштовано')
    } else {
      fail('settings.json: [nginx].editor.defaultFormatter має бути ahmadalli.vscode-nginx-conf')
    }
  } else {
    fail('Очікується .vscode/settings.json з форматером nginx і formatOnSave (див. nginx-default-tpl.mdc)')
  }

  return reporter.getExitCode()
}
