# Форма сервіс-орієнтованого deploy-pipeline (`.azurepipelines/**/*.yml`,
# крім `templates/**`). Дзеркало ga.service_deploy_workflow для Azure Pipelines.
#
# Дискримінатор застосовності — НЕ імʼя файлу, а `trigger.paths.include`:
# файл із paths-фільтром = сервісний pipeline і мусить відповідати формі;
# файл без нього (repo-wide) — жодних deny. Кореневий azure-pipelines.yml
# поза walkGlob узагалі (канон pipeline_common).
#
# Канон (azure-pipelines.mdc, сніпет template/deploy-service-pipeline.yml.snippet.yml):
#   plan (checkout fetchDepth:0 + bun install + `bunx n-rules ci plan --path <svc> --azure`,
#         крок з `name: plan`)
#     ├─ lint_<domain> × N  (dependsOn: plan; condition по dependencies.plan.outputs['plan.<domain>'];
#     │                      `bunx n-rules lint <domain> --path <svc> --no-fix`)
#     ├─ run_tests          (dependsOn: plan)
#     └─ build_and_push/deploy (dependsOn-ланцюг досягає plan і всі перевірки;
#                               condition: not(canceled()) + 'Skipped'-толерантність)
#
# Template-розкладка (`- template:` з параметром-каталогом) законна: rego тоді
# перевіряє лише видиме у файлі — наявність template-посилання з параметром,
# що дорівнює одному з paths.include; повна перевірка графа — .mdc-канон.
package azure_pipelines.service_deploy_pipeline

import rego.v1

# ── extraction ──────────────────────────────────────────────────────────

service_paths contains p if {
	some p in input.trigger.paths.include
	is_string(p)
}

is_service_pipeline if count(service_paths) > 0

# Джоби на будь-якій глибині (root jobs / stages→jobs).
all_jobs contains j if {
	walk(input, [_, j])
	is_object(j)
	is_string(object.get(j, "job", 0))
}

# `- template:`-посилання з параметрами (efes-стиль modulePath).
template_refs contains t if {
	walk(input, [_, t])
	is_object(t)
	is_string(object.get(t, "template", 0))
}

template_covers_service if {
	some t in template_refs
	some v in object.get(t, "parameters", {})
	v in service_paths
}

plan_jobs contains j if {
	some j in all_jobs
	j.job == "plan"
}

plan_runs contains r if {
	some j in plan_jobs
	some r in job_cmds(j)
	contains(r, "n-rules ci plan")
}

# Lint-джоби (`n-rules lint <domain> … --path …`) з розібраною командою.
lint_cmds contains cmd if {
	some j in all_jobs
	j.job != "plan"
	some r in job_cmds(j)
	m := regex.find_all_string_submatch_n(`n-rules lint\s+([a-z0-9-]+)\s+[^\n]*--path\s+(\S+)`, r, 1)
	count(m) > 0
	cmd := {"job": j.job, "spec": j, "domain": m[0][1], "path": m[0][2], "run": r}
}

check_jobs contains cmd.job if some cmd in lint_cmds

# Граф dependsOn і транзитивна досяжність (ланцюг deploy → build → перевірки).
needs_graph[name] := depends_of(j) if {
	some j in all_jobs
	name := j.job
}

all_needed contains n if {
	some j in all_jobs
	some n in depends_of(j)
}

terminal_jobs contains j.job if {
	some j in all_jobs
	j.job != "plan"
	not j.job in check_jobs
	not j.job in all_needed
}

job_by_name[name] := j if {
	some j in all_jobs
	name := j.job
}

# ── deny: plan-джоба ────────────────────────────────────────────────────

deny contains msg if {
	is_service_pipeline
	count(all_jobs) > 0
	count(plan_jobs) == 0
	not template_covers_service
	msg := "service-pipeline: немає job `plan` з кроком `bunx n-rules ci plan --path <svc> --azure` (azure-pipelines.mdc: сервіс-канон)"
}

deny contains msg if {
	is_service_pipeline
	count(all_jobs) == 0
	count(template_refs) > 0
	not template_covers_service
	msg := "service-pipeline: `- template:` без параметра-каталогу з trigger.paths.include — гейт не привʼязаний до сервісу (azure-pipelines.mdc)"
}

deny contains msg if {
	msg := "service-pipeline: job `plan` без кроку `bunx n-rules ci plan …` (azure-pipelines.mdc: сервіс-канон)"
	is_service_pipeline
	some j in plan_jobs
	count([r | some r in job_cmds(j); contains(r, "n-rules ci plan")]) == 0
}

deny contains msg if {
	msg := "service-pipeline: `ci plan` без `--azure` — outputs не стануть змінними джоби (azure-pipelines.mdc)"
	is_service_pipeline
	some r in plan_runs
	not contains(r, "--azure")
}

deny contains msg if {
	is_service_pipeline
	some r in plan_runs
	m := regex.find_all_string_submatch_n(`n-rules ci plan\s+--path\s+(\S+)`, r, 1)
	count(m) > 0
	not m[0][1] in service_paths
	msg := sprintf("service-pipeline: `ci plan --path %s` ∉ trigger.paths.include — план рахується не для того каталогу (azure-pipelines.mdc)", [m[0][1]])
}

# Outputs адресуються як dependencies.plan.outputs['plan.<key>'] — крок мусить мати name: plan.
deny contains msg if {
	msg := "service-pipeline: крок `ci plan` без `name: plan` — downstream-condition не знайде outputs (azure-pipelines.mdc)"
	is_service_pipeline
	some j in plan_jobs
	count([s | some s in object.get(j, "steps", []); contains(step_cmd(s), "n-rules ci plan"); s.name == "plan"]) == 0
}

# ── deny: lint-джоби ────────────────────────────────────────────────────

deny contains msg if {
	is_service_pipeline
	some cmd in lint_cmds
	not "plan" in depends_of(cmd.spec)
	msg := sprintf("%s: lint-джоба мусить мати dependsOn: plan (azure-pipelines.mdc: сервіс-канон)", [cmd.job])
}

deny contains msg if {
	is_service_pipeline
	some cmd in lint_cmds
	cond := object.get(cmd.spec, "condition", "")
	not contains(cond, sprintf("dependencies.plan.outputs['plan.%s']", [replace(cmd.domain, "-", "_")]))
	msg := sprintf("%s: lint-джоба без condition по dependencies.plan.outputs['plan.%s'] — крок не скіпатиметься (azure-pipelines.mdc)", [cmd.job, replace(cmd.domain, "-", "_")])
}

deny contains msg if {
	is_service_pipeline
	some cmd in lint_cmds
	not cmd.path in service_paths
	msg := sprintf("%s: `lint %s --path %s` ∉ trigger.paths.include — лінтиться інший каталог (azure-pipelines.mdc)", [cmd.job, cmd.domain, cmd.path])
}

deny contains msg if {
	is_service_pipeline
	some cmd in lint_cmds
	not contains(cmd.run, "--no-fix")
	msg := sprintf("%s: `n-rules lint` у CI мусить мати `--no-fix` (azure-pipelines.mdc)", [cmd.job])
}

deny contains msg if {
	is_service_pipeline
	some cmd in lint_cmds
	not job_has_prep(cmd.spec)
	msg := sprintf("%s: lint-джоба без prep-кроку `bun install --frozen-lockfile` (джоби не шарять ФС) (azure-pipelines.mdc)", [cmd.job])
}

# ── deny: fetchDepth для git-дельти ─────────────────────────────────────

deny contains msg if {
	msg := "plan: checkout мусить мати fetchDepth: 0 — без історії git-дельта `ci plan` не рахується (azure-pipelines.mdc)"
	is_service_pipeline
	some j in plan_jobs
	count([r | some r in job_cmds(j); contains(r, "n-rules ci plan")]) > 0
	not job_has_full_checkout(j)
}

deny contains msg if {
	is_service_pipeline
	some cmd in lint_cmds
	not job_has_full_checkout(cmd.spec)
	msg := sprintf("%s: checkout мусить мати fetchDepth: 0 — без історії `lint --path` не бачить дельти (azure-pipelines.mdc)", [cmd.job])
}

# ── deny: термінальні (deploy) джоби ────────────────────────────────────

deny contains msg if {
	is_service_pipeline
	count(check_jobs) > 0
	some name in terminal_jobs
	not "plan" in graph.reachable(needs_graph, {name})
	msg := sprintf("%s: термінальна джоба не досягає `plan` через dependsOn-ланцюг (azure-pipelines.mdc: сервіс-канон)", [name])
}

deny contains msg if {
	is_service_pipeline
	some name in terminal_jobs
	some cj in check_jobs
	not cj in graph.reachable(needs_graph, {name})
	msg := sprintf("%s: термінальна джоба не досягає перевірки `%s` через dependsOn-ланцюг — деплой не гейтиться нею (azure-pipelines.mdc)", [name, cj])
}

# Skipped-лінт (умовний гейт спрацював) не мусить блокувати деплой, fail — мусить:
# канон `and(not(canceled()), in(dependencies.<j>.result, 'Succeeded', 'Skipped'), …)`.
deny contains msg if {
	is_service_pipeline
	some name in terminal_jobs
	needed := depends_of(job_by_name[name])
	count([cj | some cj in check_jobs; cj in needed]) > 0
	cond := object.get(job_by_name[name], "condition", "")
	not skip_tolerant(cond)
	msg := sprintf("%s: джоба з dependsOn на умовні lint-джоби мусить мати condition із not(canceled()) і 'Skipped'-толерантністю — інакше skipped-лінт назавжди блокує деплой (azure-pipelines.mdc)", [name])
}

# ── helpers ─────────────────────────────────────────────────────────────

# dependsOn: string | array → array.
depends_of(job) := [n] if {
	n := object.get(job, "dependsOn", [])
	is_string(n)
}

depends_of(job) := object.get(job, "dependsOn", []) if is_array(object.get(job, "dependsOn", []))

# Команда кроку: `script:` або `bash:`.
step_cmd(step) := s if {
	s := object.get(step, "script", "")
	s != ""
}

step_cmd(step) := s if {
	object.get(step, "script", "") == ""
	s := object.get(step, "bash", "")
	s != ""
}

step_cmd(step) := "" if {
	object.get(step, "script", "") == ""
	object.get(step, "bash", "") == ""
}

job_cmds(job) := [c |
	some step in object.get(job, "steps", [])
	c := step_cmd(step)
	c != ""
]

job_has_prep(job) if {
	some c in job_cmds(job)
	contains(c, "bun install --frozen-lockfile")
}

job_has_full_checkout(job) if {
	some step in object.get(job, "steps", [])
	object.get(step, "checkout", "") != ""
	step.fetchDepth == 0
}

skip_tolerant(cond) if {
	contains(cond, "not(canceled())")
	contains(cond, "'Skipped'")
}
