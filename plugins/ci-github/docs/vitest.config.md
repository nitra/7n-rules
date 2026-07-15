---
type: JS Module
title: vitest.config.mjs
resource: plugins/ci-github/vitest.config.mjs
docgen:
  crc: e83cb6d7
---

Vitest-конфіг плагіна — скорочена копія `npm/vitest.config.js`: include лише `rules/**/tests/**/*.test.{js,mjs}`, environment node, `pool: 'forks'`, `testTimeout: 20000`. Env-канон успадкований: `GIT_TRACE2_EVENT=0` вимикає git trace2-сокет (git-ai) для git-процесів у тестах; `N_LLM_TRACE_PATH` відводить LLM wire-trace у tmp, щоб тестові прогони не засмічували глобальний трейс.
