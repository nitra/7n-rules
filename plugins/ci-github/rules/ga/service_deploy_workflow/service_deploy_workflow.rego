# Форма сервіс-орієнтованого deploy-workflow (`.github/workflows/*.yml`).
#
# Дискримінатор застосовності — НЕ імʼя файлу, а ЗМІСТ (дзеркало ci-azure):
# сервісний workflow = `on.push.paths` має dir-scoped glob (`npm/**`,
# `run/nexus/**`). Імʼя довільне (`npm-publish.yml`, `deploy-*.yml`, …) —
# перейменування часто неможливе: OIDC trusted publishing привʼязаний до
# імені workflow-файлу. Глоби за типом файлу (`**/*.js`, lint-*.yml) і
# workflow без paths — поза каноном. Plan-гейт вимагається лише коли у
# workflow Є lint-джоби (`n-rules lint … --path`) — publish/deploy-workflow
# без сервісних lint-джоб валідний as-is (перехід на гейт — свідоме рішення).
#
# Канон (ga.mdc, сніпет template/deploy-service.yml.snippet.yml):
#   plan (checkout fetch-depth:0 + prep + `bunx n-rules ci plan --path <svc> --github`)
#     ├─ lint-<domain> × N  (needs: plan; if: needs.plan.outputs.<domain> == 'true';
#     │                      `bunx n-rules lint <domain> --path <svc> --no-fix`)
#     ├─ test               (needs: plan)
#     └─ deploy             (needs-ланцюг досягає plan і ВСІ lint-джоби;
#                            if: !cancelled() + !contains(needs.*.result, 'failure'))
#
# Перелік сервісів консюмер-специфічний — концерн перевіряє ФОРМУ, не реєстр.
# Ланцюги deploy (build → deploy) законні: досяжність — graph.reachable.
#
# Не перевіряється тут (лишається .mdc-каноном): вибір набору доменів під
# сервіс, зміст test/deploy-кроків, outputs-мапінг plan-джоби, uv-prep для
# python-стеку. Спільні workflow-перевірки (persist-credentials, min-версії
# uses) — у ga.workflow_common; існування paths-глобів — у ga/workflows.
package ga.service_deploy_workflow

import rego.v1

# ── extraction ──────────────────────────────────────────────────────────

jobs := object.get(input, "jobs", {})

# YAML-парсери розходяться щодо `on:`: YAML 1.2 → ключ "on", YAML 1.1 → bool true,
# а конвеєр conftest (YAML→JSON) серіалізує bool-ключ у РЯДОК "true" — покриваємо всі три.
on_block := object.union_n([
	object.get(input, "on", {}),
	object.get(input, true, {}),
	object.get(input, "true", {}),
])

push_paths contains p if some p in object.get(object.get(on_block, "push", {}), "paths", [])

# Dir-scoped глоби тригера (`npm/**`, `run/nexus/**`) — дискримінатор сервісного
# workflow; глоби за типом файлу (`**/*.js`) чи точкові шляхи — ні.
service_dir_globs contains p if {
	some p in push_paths
	regex.match(`^[^*]+/\*\*$`, p)
}

is_service_workflow if count(service_dir_globs) > 0

plan_runs contains r if {
	some step in object.get(object.get(jobs, "plan", {}), "steps", [])
	r := object.get(step, "run", "")
	contains(r, "n-rules ci plan")
}

# Сервісний каталог із команди plan-джоби (`--path <svc>`).
service_paths contains p if {
	some r in plan_runs
	m := regex.find_all_string_submatch_n(`n-rules ci plan\s+--path\s+(\S+)`, r, 1)
	count(m) > 0
	p := m[0][1]
}

# Lint-джоби (крок `n-rules lint <domain> … --path …`) з розібраною командою.
lint_cmds contains cmd if {
	some name, job in jobs
	name != "plan"
	some step in object.get(job, "steps", [])
	r := object.get(step, "run", "")
	m := regex.find_all_string_submatch_n(`n-rules lint\s+([a-z0-9-]+)\s+[^\n]*--path\s+(\S+)`, r, 1)
	count(m) > 0
	cmd := {"job": name, "domain": m[0][1], "path": m[0][2], "run": r}
}

check_jobs contains cmd.job if some cmd in lint_cmds

# Наявність lint-джоб (domain-style або легасі `lint --path` без домену) —
# лише тоді вимагаємо plan-гейт.
has_lint_jobs if count(lint_cmds) > 0

has_lint_jobs if {
	some job in jobs
	some step in object.get(job, "steps", [])
	regex.match(`n-rules lint\s+--path\s+\S+`, object.get(step, "run", ""))
}

# Граф залежностей і транзитивна досяжність (ланцюг deploy → build → lint).
needs_graph[name] := needs_of(job) if some name, job in jobs

all_needed contains n if {
	some job in jobs
	some n in needs_of(job)
}

# Термінальні джоби: ніхто від них не залежить (крім plan/lint-джоб).
terminal_jobs contains name if {
	some name in object.keys(jobs)
	name != "plan"
	not name in check_jobs
	not name in all_needed
}

# ── deny: plan-джоба ────────────────────────────────────────────────────

deny contains msg if {
	is_service_workflow
	has_lint_jobs
	count(jobs) > 0
	not jobs.plan
	msg := "service-workflow: немає job `plan` з кроком `bunx n-rules ci plan --path <svc> --github` (ga.mdc: сервіс-канон)"
}

deny contains msg if {
	is_service_workflow
	jobs.plan
	count(plan_runs) == 0
	msg := "service-workflow: job `plan` без кроку `bunx n-rules ci plan …` (ga.mdc: сервіс-канон)"
}

deny contains msg if {
	msg := "service-workflow: `ci plan` без `--path <serviceDir>` (ga.mdc: сервіс-канон)"
	is_service_workflow
	some r in plan_runs
	not regex.match(`n-rules ci plan\s+--path\s+\S+`, r)
}

deny contains msg if {
	msg := "service-workflow: `ci plan` без `--github` — outputs не потраплять у $GITHUB_OUTPUT (ga.mdc)"
	is_service_workflow
	some r in plan_runs
	not contains(r, "--github")
}

# ── deny: тригер paths ↔ сервісний каталог ─────────────────────────────

deny contains msg if {
	is_service_workflow
	some sp in service_paths
	not glob_covers(sp)
	msg := sprintf("service-workflow: on.push.paths не містить glob для сервісного каталогу %s (ga.mdc)", [sp])
}

# ── deny: lint-джоби ────────────────────────────────────────────────────

deny contains msg if {
	is_service_workflow
	some cmd in lint_cmds
	not "plan" in needs_of(jobs[cmd.job])
	msg := sprintf("%s: lint-джоба мусить мати needs: plan (ga.mdc: сервіс-канон)", [cmd.job])
}

deny contains msg if {
	is_service_workflow
	some cmd in lint_cmds
	cond := object.get(jobs[cmd.job], "if", "")
	not contains(cond, sprintf("needs.plan.outputs.%s", [replace(cmd.domain, "-", "_")]))
	msg := sprintf("%s: lint-джоба без гейта `if: needs.plan.outputs.%s == 'true'` — крок не скіпатиметься (ga.mdc)", [cmd.job, replace(cmd.domain, "-", "_")])
}

deny contains msg if {
	is_service_workflow
	some cmd in lint_cmds
	not glob_covers(cmd.path)
	msg := sprintf("%s: `lint %s --path %s` ∉ on.push.paths — лінтиться інший каталог (ga.mdc)", [cmd.job, cmd.domain, cmd.path])
}

deny contains msg if {
	is_service_workflow
	some cmd in lint_cmds
	not contains(cmd.run, "--no-fix")
	msg := sprintf("%s: `n-rules lint` у CI мусить мати `--no-fix` (ga.mdc)", [cmd.job])
}

deny contains msg if {
	is_service_workflow
	some cmd in lint_cmds
	not job_has_prep(jobs[cmd.job])
	msg := sprintf("%s: lint-джоба без prep-кроку `uses: ./.github/actions/setup-bun-deps` (джоби не шарять ФС) (ga.mdc)", [cmd.job])
}

# ── deny: fetch-depth для git-дельти ────────────────────────────────────

deny contains msg if {
	is_service_workflow
	count(plan_runs) > 0
	not job_has_full_checkout(jobs.plan)
	msg := "plan: checkout мусить мати fetch-depth: 0 — без історії git-дельта `ci plan` не рахується (ga.mdc)"
}

deny contains msg if {
	is_service_workflow
	some cmd in lint_cmds
	not job_has_full_checkout(jobs[cmd.job])
	msg := sprintf("%s: checkout мусить мати fetch-depth: 0 — без історії `lint --path` не бачить дельти (ga.mdc)", [cmd.job])
}

# ── deny: термінальні (deploy) джоби ────────────────────────────────────

deny contains msg if {
	is_service_workflow
	count(check_jobs) > 0
	some name in terminal_jobs
	not "plan" in graph.reachable(needs_graph, {name})
	msg := sprintf("%s: термінальна джоба не досягає `plan` через needs-ланцюг (ga.mdc: сервіс-канон)", [name])
}

deny contains msg if {
	is_service_workflow
	some name in terminal_jobs
	some cj in check_jobs
	not cj in graph.reachable(needs_graph, {name})
	msg := sprintf("%s: термінальна джоба не досягає перевірки `%s` через needs-ланцюг — деплой не гейтиться нею (ga.mdc)", [name, cj])
}

# Skipped-лінт (умовний гейт спрацював) не мусить блокувати деплой, а fail —
# мусить: канонічний if = `!cancelled() && !contains(needs.*.result, 'failure')`.
deny contains msg if {
	is_service_workflow
	some name in terminal_jobs
	needed := needs_of(jobs[name])
	count([cj | some cj in check_jobs; cj in needed]) > 0
	cond := object.get(jobs[name], "if", "")
	not skip_tolerant(cond)
	msg := sprintf("%s: джоба з needs на умовні lint-джоби мусить мати if із `!cancelled()` і `!contains(needs.*.result, 'failure')` — інакше skipped-лінт назавжди блокує деплой (ga.mdc)", [name])
}

# ── helpers ─────────────────────────────────────────────────────────────

# needs: string | array → array.
needs_of(job) := [n] if {
	n := object.get(job, "needs", [])
	is_string(n)
}

needs_of(job) := object.get(job, "needs", []) if is_array(object.get(job, "needs", []))

# Каталог `--path` покривається dir-scoped глобом тригера
# (`npm/**` покриває `npm`; точний збіг теж).
glob_covers(sp) if {
	some g in service_dir_globs
	startswith(g, sp)
}

job_has_prep(job) if {
	some step in object.get(job, "steps", [])
	step.uses == "./.github/actions/setup-bun-deps"
}

job_has_full_checkout(job) if {
	some step in object.get(job, "steps", [])
	startswith(object.get(step, "uses", ""), "actions/checkout@")
	step.with["fetch-depth"] == 0
}

skip_tolerant(cond) if {
	contains(cond, "!cancelled()")
	contains(cond, "needs.*.result")
}
