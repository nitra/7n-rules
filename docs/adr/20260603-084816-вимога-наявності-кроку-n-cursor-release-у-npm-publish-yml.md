---
session: c4c724d5-1ad9-445e-b62e-c45636474f2b
captured: 2026-06-03T08:48:16+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/c4c724d5-1ad9-445e-b62e-c45636474f2b/c4c724d5-1ad9-445e-b62e-c45636474f2b.jsonl
---

**Не вимагають.** Policy `npm_publish_yml.rego` enforce-ить лише 4 умови: `on.push.paths` ⊇ `npm/**`, `on.push.branches` ⊇ `main`, `id-token: write` в хоч одному job, наявність кроку `JS-DevTools/npm-publish@...` з `with.package: npm/package.json`. Блок 34-40 (`Configure git identity` + `Release`) — це твоє **легітимне розширення**, policy його не перевіряє й не забороняє.

---

[user]
<timestamp>Wednesday, Jun 3, 2026, 8:54 AM (UTC+3)</timestamp>
<user_query>
Якщо правило немає такої вимоги, чи не варто нам додати? Зараз є правило в n-npm-module.mdc: кожен npm-модуль має бути виданий через Провели аудит, що цей workflow корректний, і варто закріпити у правилі вимогу що npm publish в CI **завжди** повинен включати крок release (bump, changelog, tag) перед публікацією.
</user_query>
[assistant]
Хороша пропозиція. Перш ніж робити — давай уточнимо два моменти, щоб правило вийшло точним:

**1. Чи release-крок завжди в тому ж job або може бути окремим job-ом?**

Зараз у тебе `Configure git identity` + `release` → `npm-publish` — все в одному job. Але теоретично release може бути окремим job-ом (наприклад, `release` → artifact → `publish`). Правило enforce-ить це на рівні файлу чи job-а?

**2. Що конкретно повинен перевіряти check?**

Варіанти (від слабшого до жорсткішого):
- a) у файлі є **будь-який** крок, де `run:` містить `n-cursor release` або `n-cursor.js release`
- b) у тому ж job, що і `npm-publish`, є крок `n-cursor release` **до** нього (order-check)
- c) кроки `Configure git identity` + `n-cursor release` обидва присутні (оскільки release потребує git-ідентифікації)

Я схиляюся до **(a)** як мінімально необхідного й надійного: перевіряємо, що release-команда є у файлі, не диктуємо структуру job-ів. Але якщо у вас є strong opinion — скажи, тоді реалізую відповідно.
[user]
<timestamp>Wednesday, Jun 3, 2026, 8:55 AM (UTC+3)</timestamp>
<user_query>
(a) і давай додамо це до правила вразу
</user_query>
[assistant]
Читаю поточний стан файлів.
[tool: Read] {"path":"/Users/vitalii/www/nitra/cursor/npm/rules/npm-module/policy/npm_publish_yml/npm_publish_yml.rego"}
[tool: Read] {"path":"/Users/vitalii/www/nitra/cursor/.cursor/rules/n-npm-module.mdc"}
[assistant]
[tool: Read] {"path":"/Users/vitalii/www/nitra/cursor/npm/rules/npm-module/policy/npm_publish_yml"}
[assistant]
[tool: Read] {"path":"/Users/vitalii/www/nitra/cursor/npm/rules/npm-module/policy/npm_publish_yml/check-npm-publish-yml.mjs"}
[assistant]
Маю всі потрібні файли. Вносжу зміни в три місця.
[tool: Edit] {"path":"/Users/vitalii/www/nitra/cursor/npm/rules/npm-module/policy/npm_publish_yml/npm_publish_yml.rego", "old_string":"# 4. Є крок npm-publish (JS-DevTools/npm-publish)\nhas_npm_publish_step if {\n\tsome job_key in object.keys(input.jobs)\n\tsome step in input.jobs[job_key].steps\n\tstartswith(step.uses, \"JS-DevTools/npm-publish\")\n\tstep[\"with\"][\"package\"] == \"npm/package.json\"\n}\n\ndeny contains msg if {\n\tnot has_npm_publish_step\n\tmsg := \"npm-publish.yml: відсутній крок 'JS-DevTools/npm-publish' з with.package = npm/package.json\"\n}", "new_string":"# 4. Є крок npm-publish (JS-DevTools/npm-publish)\nhas_npm_publish_step if {\n\tsome job_key in object.keys(input.jobs)\n\tsome step in input.jobs[job_key].steps\n\tstartswith(step.uses, \"JS-DevTools/npm-publish\")\n\tstep[\"with\"][\"package\"] == \"npm/package.json\"\n}\n\ndeny contains msg if {\n\tnot has_npm_publish_step\n\tmsg := \"npm-publish.yml: відсутній крок 'JS-DevTools/npm-publish' з with.package = npm/package.json\"\n}\n\n# 5. Є крок n-cursor release (bump + CHANGELOG + tag) перед публікацією\nhas_release_step if {\n\tsome job_key in object.keys(input.jobs)\n\tsome step in input.jobs[job_key].steps\n\tcontains(step.run, \"n-cursor\")\n\tcontains(step.run, \"release\")\n}\n\ndeny contains msg if {\n\tnot has_release_step\n\tmsg := \"npm-publish.yml: відсутній крок з командою 'n-cursor release' (bump + CHANGELOG + tag)\"\n}"}
[assistant]
[tool: Read] {"path":"/Users/vitalii/www/nitra/cursor/npm/rules/npm-module/policy/npm_publish_yml/check-npm-publish-yml.mjs"}
[assistant]
[tool: Edit] {"path":"/Users/vitalii/www/nitra/cursor/npm/rules/npm-module/policy/npm_publish_yml/check-npm-publish-yml.mjs", "old_string":"/**\n * 4. Є крок JS-DevTools/npm-publish з with.package = npm/package.json\n */\nexport function checkNpmPublishStep(workflow) {\n  const jobs = Object.values(workflow?.jobs ?? {});\n  return jobs.some((job) =>\n    (job.steps ?? []).some(\n      (step) =>\n        typeof step.uses === 'string' &&\n        step.uses.startsWith('JS-DevTools/npm-publish') &&\n        step.with?.package === 'npm/package.json'\n    )\n  );\n}", "new_string":"/**\n * 4. Є крок JS-DevTools/npm-publish з with.package = npm/package.json\n */\nexport function checkNpmPublishStep(workflow) {\n  const jobs = Object.values(workflow?.jobs ?? {});\n  return jobs.some((job) =>\n    (job.steps ?? []).some(\n      (step) =>\n        typeof step.uses === 'string' &&\n        step.uses.startsWith('JS-DevTools/npm-publish') &&\n        step.with?.package === 'npm/package.json'\n    )\n  );\n}\n\n/**\n * 5. Є крок з командою `n-cursor release` (bump + CHANGELOG + tag).\n * Перевіряє будь-який job у файлі — крок може бути в окремому job.\n */\nexport function checkReleaseStep(workflow) {\n  const jobs = Object.values(workflow?.jobs ?? {});\n  return jobs.some((job) =>\n    (job.steps ?? []).some(\n      (step) =>\n        typeof step.run === 'string' &&\n        step.run.includes('n-cursor') &&\n        step.run.includes('release')\n    )\n  );\n}"}
[assistant]
Тепер перевірю, де ці `check*`-функції використовуються, щоб додати виклик нової.
[tool: Grep] {"pattern":"checkNpmPublishStep", "path":"/Users/vitalii/www/nitra/cursor/npm/rules/npm-module"}
[assistant]
[tool: Read] {"path":"/Users/vitalii/www/nitra/cursor/npm/rules/npm-module/policy/npm_publish_yml/check-npm-publish-yml.test.mjs"}
[assistant]
Тепер оновлюю `.mdc` (додаю вимогу до канону workflow) і тест-файл. Ці дві операції незалежні — роблю паралельно.
[tool: Edit] {"path":"/Users/vitalii/www/nitra/cursor/.cursor/rules/n-npm-module.mdc", "old_string":"- `on.push.paths` включає `npm/**`\n- `on.push.branches` включає `main`\n- Один із jobs має `permissions.id-token: write`\n- Є крок `uses: JS-DevTools/npm-publish@...` з `with.package: npm/package.json`", "new_string":"- `on.push.paths` включає `npm/**`\n- `on.push.branches` включає `main`\n- Один із jobs має `permissions.id-token: write`\n- Є крок `uses: JS-DevTools/npm-publish@...` з `with.package: npm/package.json`\n- Є крок із командою `n-cursor release` (bump версії, CHANGELOG, git-тег) — **до** публікації"}
[tool: Edit] {"path":"/Users/vitalii/www/nitra/cursor/npm/rules/npm-module/policy/npm_publish_yml/check-npm-publish-yml.test.mjs", "old_string":"import {\n  checkBranches,\n  checkIdToken,\n  checkNpmPublishStep,\n  checkPaths,\n} from './check-npm-publish-yml.mjs';", "new_string":"import {\n  checkBranches,\n  checkIdToken,\n  checkNpmPublishStep,\n  checkPaths,\n  checkReleaseStep,\n} from './check-npm-publish-yml.mjs';"}
[assistant]
Читаю тест повністю, щоб додати тест-кейс для `checkReleaseStep`.
[tool: Read] {"path":"/Users/vitalii/www/nitra/cursor/npm/rules/npm-module/policy/npm_publish_yml/check-npm-publish-yml.test.mjs"}
[assistant]
[tool: Edit] {"path":"/Users/vitalii/www/nitra/cursor/npm/rules/npm-module/policy/npm_publish_yml/check-npm-publish-yml.test.mjs", "old_string":"describe('checkNpmPublishStep', () => {", "new_string":"describe('checkReleaseStep', () => {\n  const makeWorkflow = (run) => ({\n    jobs: { publish: { steps: [{ run }] } },\n  });\n\n  it('returns true when step contains n-cursor release', () => {\n    expect(\n      checkReleaseStep(\n        makeWorkflow('node npm/bin/n-cursor.js release')\n      )\n    ).toBe(true);\n  });\n\n  it('returns true for npx variant', () => {\n    expect(\n      checkReleaseStep(makeWorkflow('npx n-cursor release --yes'))\n    ).toBe(true);\n  });\n\n  it('returns false when release step is absent', () => {\n    expect(\n      checkReleaseStep({ jobs: { publish: { steps: [{ run: 'echo done' }] } } })\n    ).toBe(false);\n  });\n\n  it('returns false for empty workflow', () => {\n    expect(checkReleaseStep({})).toBe(false);\n  });\n});\n\ndescribe('checkNpmPublishStep', () => {"}
[assistant]
Запускаю тести.
[tool: Bash] {"command":"cd /Users/vitalii/www/nitra/cursor && bun test npm/rules/npm-module/policy/npm_publish_yml/ 2>&1"}
[assistant]
Всі тести пройшли. Три файли оновлено:

1. **`npm_publish_yml.rego`** — додано deny-правило №5: відсутній крок `n-cursor … release`.
2. **`check-npm-publish-yml.mjs`** — додано `checkReleaseStep()` (JS-варіант тієї ж перевірки).
3. **`check-npm-publish-yml.test.mjs`** — 4 нові тест-кейси для `checkReleaseStep`.
4. **`n-npm-module.mdc`** — до списку вимог workflow додано пункт про `n-cursor release`.

---

[end of transcript]

## ADR Вимога наявності кроку `n-cursor release` у `npm-publish.yml`

## Context and Problem Statement
Workflow `.github/workflows/npm-publish.yml` реально включає кроки `Configure git identity` та `n-cursor release` (bump версії, CHANGELOG, git-тег) перед публікацією npm-пакету. Однак канонічне правило `n-npm-module.mdc` і policy `npm_publish_yml.rego` не перевіряли наявність цього кроку — можна було опублікувати пакет без попереднього release-кроку і не отримати жодного порушення.

## Considered Options
* (a) Перевіряти наявність будь-якого кроку, де `run:` містить `n-cursor` і `release` (в будь-якому job файлу)
* (b) Перевіряти, що release-крок знаходиться в тому ж job і стоїть до кроку `JS-DevTools/npm-publish` (order-check)
* (c) Перевіряти наявність обох кроків: `Configure git identity` + `n-cursor release`

## Decision Outcome
Chosen option: "(a) будь-який крок із `n-cursor … release` у файлі", because варіант (a) є мінімально необхідним і надійним: не диктує структуру job-ів і охоплює різні форми виклику (`node npm/bin/n-cursor.js release`, `npx n-cursor release`).

### Consequences
* Good, because `npm-publish.yml` без release-кроку тепер отримає deny від `npm_publish_yml.rego` з повідомленням `"відсутній крок з командою 'n-cursor release'"`.
* Bad, because перевірка не гарантує порядок виконання — release теоретично може стояти після `JS-DevTools/npm-publish`. Transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли:
- `npm/rules/npm-module/policy/npm_publish_yml/npm_publish_yml.rego` — додано deny-правило №5 (`has_release_step`)
- `npm/rules/npm-module/policy/npm_publish_yml/check-npm-publish-yml.mjs` — додано `checkReleaseStep()`
- `npm/rules/npm-module/policy/npm_publish_yml/check-npm-publish-yml.test.mjs` — 4 нові тест-кейси
- `.cursor/rules/n-npm-module.mdc` — до списку вимог workflow додано пункт про `n-cursor release`
