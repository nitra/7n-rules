# Перевірка `.github/workflows/git-ai.yml` (ga.mdc).
#
# Канон надходить через --data: { "template": { "snippet": ... } }
# Структура --data сформована з template/git-ai.yml.snippet.yml.
# Substring-перевірки (`if:`, `run:` блоки) — на основі ключових фраз з template
# steps, бо повний multi-line `run:` дуже крихкий для exact-match.
package ga.git_ai

import rego.v1

# ── Аліаси ─────────────────────────────────────────────────────────────────

gha_on := input["true"]

job := input.jobs["git-ai"]

job_run_blob := concat("\n", [run |
	run := job.steps[_].run
])

expected_name := data.template.snippet.name

expected_types := {t | some t in data.template.snippet.on.pull_request.types}

expected_if := data.template.snippet.jobs["git-ai"].if

expected_perms := data.template.snippet.jobs["git-ai"].permissions

# Substring-маркери з template `run:` блоків — ключові команди, наявність яких
# гарантує що workflow робить очікувані дії. Конкретний multi-line — не порівнюємо.
install_substring := "https://usegitai.com/install.sh"

run_substring := "git-ai ci github run"

# ── deny rules ─────────────────────────────────────────────────────────────

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
	not contains(job_if_str, expected_if)
	msg := sprintf("git-ai.yml: job має містити if: %s (ga.mdc)", [expected_if])
}

deny contains msg if {
	job.permissions.contents != expected_perms.contents
	msg := sprintf("git-ai.yml: permissions.contents має бути %s (ga.mdc)", [expected_perms.contents])
}

deny contains msg if {
	not contains(job_run_blob, install_substring)
	msg := "git-ai.yml: має встановлювати git-ai через curl | bash (ga.mdc)"
}

deny contains msg if {
	not contains(job_run_blob, run_substring)
	msg := sprintf("git-ai.yml: має виконувати %s (ga.mdc)", [run_substring])
}

# ── helpers ────────────────────────────────────────────────────────────────

default job_if_str := ""

job_if_str := sprintf("%v", [job.if])
