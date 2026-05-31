/**
 * CLI-оркестратор worktree-tool `n-cursor worktree` (виконавець конвенції `.worktrees/`).
 *
 * Підкоманди:
 *   add <branch> "<опис>"     — git worktree add .worktrees/<sanit> -b <branch> (від HEAD) + .md-опис
 *   remove <branch> [--force] — прибрати checkout + .md (гілку лишає)
 *   list                      — git worktree list + вміст .md-описів
 *   prune                     — git worktree prune + видалити осиротілі .md
 *
 * Чисті функції (санітизація, шляхи, текст опису, осиротілі) — у `lib/worktree.mjs`.
 * Тут лише git-виклики, запис файлів, парсинг argv і звіт.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { buildDescription, findOrphanDescFiles, worktreePaths } from './lib/worktree.mjs'

const USAGE = [
  'Usage:',
  '  npx @nitra/cursor worktree add <branch> "<опис>"',
  '  npx @nitra/cursor worktree remove <branch> [--force]',
  '  npx @nitra/cursor worktree list',
  '  npx @nitra/cursor worktree prune'
].join('\n')

/**
 * Запускає git, повертає { status, stdout, stderr }.
 * @param {string[]} args аргументи git
 * @param {string} cwd робочий каталог
 * @returns {{ status: number, stdout: string, stderr: string }} результат
 */
function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/**
 * Поточна дата YYYY-MM-DD (ін'єкція через ctx.now для тестів).
 * @param {() => Date} now фабрика дати
 * @returns {string} дата у форматі YYYY-MM-DD
 */
function today(now) {
  return now().toISOString().slice(0, 10)
}

/**
 * Реєстровані worktree-checkout (абсолютні шляхи) з `git worktree list --porcelain`.
 * @param {string} cwd корінь репо
 * @returns {string[]} абсолютні шляхи checkout
 */
function listRegisteredCheckouts(cwd) {
  return git(['worktree', 'list', '--porcelain'], cwd)
    .stdout.split('\n')
    .filter(line => line.startsWith('worktree '))
    .map(line => line.slice('worktree '.length).trim())
}

/**
 * Абсолютні шляхи `.worktrees/*.md`.
 * @param {string} cwd корінь репо
 * @returns {string[]} шляхи файлів-описів
 */
function listDescFiles(cwd) {
  const dir = join(cwd, '.worktrees')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(n => n.endsWith('.md'))
    .map(n => join(dir, n))
}

/**
 * add: створити worktree від HEAD + .md-опис.
 * @param {string[]} rest [branch, ...descParts]
 * @param {{ cwd: string, log: Function, logError: Function, now: () => Date }} ctx контекст
 * @returns {number} exit code
 */
function cmdAdd(rest, ctx) {
  const [branch, ...descParts] = rest
  const task = descParts.join(' ').trim()
  if (!branch) {
    ctx.logError('worktree add: потрібне імʼя гілки')
    ctx.logError(USAGE)
    return 1
  }
  if (!task) {
    ctx.logError('worktree add: опис обовʼязковий — `worktree add <branch> "<опис>"`')
    return 1
  }
  let paths
  try {
    paths = worktreePaths(ctx.cwd, branch)
  } catch (error) {
    ctx.logError(error.message)
    return 1
  }
  const added = git(['worktree', 'add', paths.checkout, '-b', branch], ctx.cwd)
  if (added.status !== 0) {
    ctx.logError(`worktree add не вдався: ${added.stderr.trim()}`)
    return 1
  }
  const baseCommit = git(['rev-parse', '--short', 'HEAD'], ctx.cwd).stdout.trim()
  const md = buildDescription({ branch, task, baseCommit, date: today(ctx.now) })
  writeFileSync(paths.descFile, md, 'utf8')
  ctx.log(`✅ worktree: ${paths.checkout}`)
  ctx.log(`   опис:    ${paths.descFile}`)
  return 0
}

/**
 * remove: прибрати checkout + .md (гілку лишає).
 * @param {string[]} rest [branch, ...flags]
 * @param {{ cwd: string, log: Function, logError: Function }} ctx контекст
 * @returns {number} exit code
 */
function cmdRemove(rest, ctx) {
  const branch = rest.find(a => !a.startsWith('--'))
  const force = rest.includes('--force')
  if (!branch) {
    ctx.logError('worktree remove: потрібне імʼя гілки')
    return 1
  }
  let paths
  try {
    paths = worktreePaths(ctx.cwd, branch)
  } catch (error) {
    ctx.logError(error.message)
    return 1
  }
  const args = ['worktree', 'remove', paths.checkout]
  if (force) args.push('--force')
  const removed = git(args, ctx.cwd)
  if (removed.status !== 0) {
    ctx.logError(`worktree remove не вдався: ${removed.stderr.trim()} (спробуй --force, якщо дерево брудне)`)
    return 1
  }
  if (existsSync(paths.descFile)) rmSync(paths.descFile, { force: true })
  ctx.log(`✅ прибрано: ${paths.checkout} (гілку ${branch} лишено)`)
  return 0
}

/**
 * list: git worktree list + вміст .md-описів.
 * @param {{ cwd: string, log: Function }} ctx контекст
 * @returns {number} exit code
 */
function cmdList(ctx) {
  ctx.log(git(['worktree', 'list'], ctx.cwd).stdout.trimEnd())
  for (const md of listDescFiles(ctx.cwd)) {
    ctx.log(`\n--- ${md} ---`)
    ctx.log(readFileSync(md, 'utf8').trimEnd())
  }
  return 0
}

/**
 * prune: git worktree prune + видалити осиротілі .md.
 * @param {{ cwd: string, log: Function }} ctx контекст
 * @returns {number} exit code
 */
function cmdPrune(ctx) {
  git(['worktree', 'prune'], ctx.cwd)
  const orphans = findOrphanDescFiles(listDescFiles(ctx.cwd), listRegisteredCheckouts(ctx.cwd))
  for (const md of orphans) {
    rmSync(md, { force: true })
    ctx.log(`🧹 видалено осиротілий опис: ${md}`)
  }
  ctx.log(`prune завершено (осиротілих описів: ${orphans.length})`)
  return 0
}

/**
 * Точка входу підкоманди worktree.
 * @param {string[]} argv аргументи після `worktree`
 * @param {{ cwd?: string, log?: Function, logError?: Function, now?: () => Date }} [options] ін'єкція для тестів
 * @returns {Promise<number>} exit code
 */
export function runWorktreeCli(argv, options = {}) {
  const ctx = {
    cwd: options.cwd ?? processCwd(),
    log: options.log ?? (line => console.log(line)),
    logError: options.logError ?? (line => console.error(line)),
    now: options.now ?? (() => new Date())
  }
  const [sub, ...rest] = argv
  switch (sub) {
    case 'add':
      return Promise.resolve(cmdAdd(rest, ctx))
    case 'remove':
      return Promise.resolve(cmdRemove(rest, ctx))
    case 'list':
      return Promise.resolve(cmdList(ctx))
    case 'prune':
      return Promise.resolve(cmdPrune(ctx))
    default:
      ctx.logError(USAGE)
      return Promise.resolve(1)
  }
}
