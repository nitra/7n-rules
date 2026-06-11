/**
 * Re-export спільного списку ignore-глобів зі скіла doc-files.
 *
 * Канонічне джерело — `npm/skills/doc-files/js/docgen-ignore.mjs`: обидва скіли
 * (file-level доки і агрегати) мусять бачити однакове дерево кодових файлів,
 * інакше агрегат посилатиметься на файли без док (або навпаки). Залежність
 * спрямована doc-aggregate → doc-files за ADR про розбиття docgen.
 */
export * from '../../doc-files/js/docgen-ignore.mjs'
