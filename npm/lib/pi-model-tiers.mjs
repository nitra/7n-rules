/** @see ./docs/pi-model-tiers.md */

/**
 * Тимчасовий shim (Ф1 виносу `@nitra/llm-lib`, спека
 * docs/specs/2026-07-05-llm-lib-extraction-spec.md): re-export тир-конфігу
 * з пакета, щоб не ламати наявні import-шляхи consumers до Ф2
 * (масового import-rewrite). Нового коду сюди не додавати —
 * імпортуй `@nitra/llm-lib/model-tiers` напряму.
 */

export * from '@nitra/llm-lib/model-tiers'
