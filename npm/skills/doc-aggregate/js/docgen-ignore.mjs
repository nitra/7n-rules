/**
 * Re-export спільного списку ignore-глобів із правила doc-files.
 *
 * Канонічне джерело — `npm/rules/doc-files/js/docgen-ignore.mjs`: скіл doc-aggregate
 * і правило doc-files мусять бачити однакове дерево кодових файлів, інакше агрегат
 * посилатиметься на файли без док (або навпаки). Залежність спрямована
 * doc-aggregate → doc-files за ADR про розбиття docgen.
 */
export * from '../../../rules/doc-files/js/docgen-ignore.mjs'
