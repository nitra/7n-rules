# Порт перевірки `validateGitAiWorkflowStructure` з `npm/scripts/check-ga.mjs` (ga.mdc).
#
# Запуск (локально):
#   conftest test .github/workflows/git-ai.yml \
#     -p npm/policy/ga --namespace ga.git_ai
#
# Структура каталогу збігається зі шляхом пакету (regal: directory-package-mismatch).
# Конвенція проєкту — `import rego.v1` + multi-value `deny contains msg if { … }`
# (.cursor/rules/conftest.mdc). Лінт — `bun run lint-rego` (regal).
package ga.git_ai

import rego.v1

# ── Очікувані значення ─────────────────────────────────────────────────────

expected_name := "Git AI"

expected_if_substring := "github.event.pull_request.merged == true"

expected_install_substring := "curl -fsSL https://usegitai.com/install.sh | bash"

expected_run_substring := "git-ai ci github run"

# ── Аліаси на input ────────────────────────────────────────────────────────
#
# YAML 1.1 quirk: `on:` → boolean true → у конфтесті ключ "true".

gha_on := input["true"]

# Job-id містить дефіс — звертаємося через `[…]`. Імʼя `job` (без префіксу пакету)
# — щоб уникнути regal-правила `rule-name-repeats-package`.
job := input.jobs["git-ai"]

# Усі `run:` зі steps цього job-а, склеєні в один blob — для substring-перевірки.
job_run_blob := concat("\n", [run |
	run := job.steps[_].run
])

# ── deny rules (контигно — regal: messy-rule) ──────────────────────────────

deny contains msg if {
	input.name != expected_name
	msg := sprintf("git-ai.yml: name має бути %q (ga.mdc)", [expected_name])
}

deny contains msg if {
	not "closed" in {t | some t in gha_on.pull_request.types}
	msg := "git-ai.yml: on.pull_request.types має містити closed (ga.mdc)"
}

deny contains msg if {
	not job
	msg := "git-ai.yml: jobs.git-ai відсутній (ga.mdc)"
}

deny contains msg if {
	not contains(job_if_str, expected_if_substring)
	msg := "git-ai.yml: job має містити if: github.event.pull_request.merged == true (ga.mdc)"
}

deny contains msg if {
	job.permissions.contents != "write"
	msg := "git-ai.yml: permissions мають бути contents: write (ga.mdc)"
}

deny contains msg if {
	not contains(job_run_blob, expected_install_substring)
	msg := "git-ai.yml: має встановлювати git-ai через curl | bash (ga.mdc)"
}

deny contains msg if {
	not contains(job_run_blob, expected_run_substring)
	msg := "git-ai.yml: має виконувати git-ai ci github run (ga.mdc)"
}

# ── helpers ────────────────────────────────────────────────────────────────

# `if` поле job-а може бути відсутнім — тоді `sprintf` дає невизначене значення
# і спрацьовує `default`, повертаючи порожній рядок; `contains(…)` нижче дасть
# false і відповідне `deny`-правило спрацює зі зрозумілим повідомленням.
default job_if_str := ""

job_if_str := sprintf("%v", [job.if])
