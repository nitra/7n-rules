/**
 * Fixture: запускається як CLI entry (process.argv[1] === цей файл),
 * друкує `TRUE`/`FALSE` залежно від результату `isRunAsCli(import.meta.url)`.
 * Споживач — `cli-entry.test.mjs::"запуск файлу як entry — true"`.
 */
import { isRunAsCli } from '../../cli-entry.mjs'

process.stdout.write(isRunAsCli(import.meta.url) ? 'TRUE' : 'FALSE')
