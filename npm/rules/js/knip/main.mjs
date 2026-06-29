import { main as knipMain } from 'knip'

/**
 * lint-поверхня js/knip: аналіз невикористаних залежностей/експортів.
 * @param {string[] | undefined} _files ігнорується (whole-repo)
 * @param {string} [cwd] корінь
 * @returns {Promise<number>}
 */
export async function lint(_files, cwd = process.cwd()) {
  // createOptions — внутрішній хелпер knip, що резолвить config/catalog/workspace перед run
  const { createOptions } = await import('knip/dist/util/create-options.js')
  const { runReporters } = await import('knip/dist/util/reporter.js')
  const options = await createOptions({ cwd, isDisableConfigHints: true })
  const results = await knipMain(options)

  await runReporters(['symbols'], {
    report: options.includedIssueTypes,
    ...results,
    cwd: options.cwd,
    isDisableConfigHints: options.isDisableConfigHints,
    isDisableTagHints: options.isDisableTagHints,
    isTreatConfigHintsAsErrors: false,
    isTreatTagHintsAsErrors: false,
    rules: options.rules,
    isProduction: options.isProduction,
    isShowProgress: false,
    maxShowIssues: undefined,
    options: ''
  })

  return results.counters.total > 0 ? 1 : 0
}
