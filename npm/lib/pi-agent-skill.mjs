/** @see ./docs/pi-agent-skill.md */

/**
 * Тимчасовий shim (Ф1 виносу `@nitra/llm-lib`, спека
 * docs/specs/2026-07-05-llm-lib-extraction-spec.md): re-export skill-раннера
 * з пакета під legacy-імʼям `runPiAgentSkill`, щоб не ламати наявні
 * import-шляхи consumers до Ф2. Нового коду сюди не додавати —
 * імпортуй `runAgentSkill` з `@nitra/llm-lib/agent-skill` напряму.
 */

export { runAgentSkill as runPiAgentSkill } from '@nitra/llm-lib/agent-skill'
