/** @see ./docs/pi-one-shot.md */

/**
 * Тимчасовий shim (Ф1 виносу `@nitra/llm-lib`, спека
 * docs/specs/2026-07-05-llm-lib-extraction-spec.md): re-export one-shot
 * раннера з пакета, щоб не ламати наявні import-шляхи consumers до Ф2.
 * Нового коду сюди не додавати — імпортуй `@nitra/llm-lib/one-shot` напряму.
 */

export * from '@nitra/llm-lib/one-shot'
