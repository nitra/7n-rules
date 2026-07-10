package k8s.lint_k8s_yml_test

import data.k8s.lint_k8s_yml
import rego.v1

template_data := {"snippet": {"jobs": {"lint-k8s": {"steps": [
	{"uses": "actions/checkout@v6", "with": {"persist-credentials": false}},
	{"uses": "./.github/actions/setup-bun-deps"},
	{"name": "Install kubeconform", "run": "curl -sSL kubeconform && sudo mv kubeconform /usr/local/bin/"},
	{"name": "Install kubescape", "run": "curl -s kubescape/install.sh | /bin/bash"},
	{"name": "Lint K8s", "run": "n-cursor lint k8s --no-fix"},
]}}}}

canonical_wf := {"jobs": {"lint-k8s": {"steps": [
	{"uses": "actions/checkout@v6", "with": {"persist-credentials": false}},
	{"uses": "./.github/actions/setup-bun-deps"},
	{"name": "Install kubeconform", "run": "curl -sSL kubeconform && sudo mv kubeconform /usr/local/bin/"},
	{"name": "Install kubescape", "run": "curl -s kubescape/install.sh | /bin/bash"},
	{"name": "Lint K8s", "run": "n-cursor lint k8s --no-fix"},
]}}}

test_allow_canonical if {
	count(lint_k8s_yml.deny) == 0 with input as canonical_wf with data.template as template_data
}

test_deny_missing_setup_bun_deps if {
	wf := {"jobs": {"lint-k8s": {"steps": [
		{"uses": "actions/checkout@v6", "with": {"persist-credentials": false}},
		{"name": "Install kubeconform", "run": "curl -sSL kubeconform && sudo mv kubeconform /usr/local/bin/"},
		{"name": "Install kubescape", "run": "curl -s kubescape/install.sh | /bin/bash"},
		{"name": "Lint K8s", "run": "n-cursor lint k8s --no-fix"},
	]}}}
	some msg in lint_k8s_yml.deny with input as wf with data.template as template_data
	contains(msg, "setup-bun-deps")
}

test_deny_missing_checkout if {
	wf := {"jobs": {"lint-k8s": {"steps": [
		{"uses": "./.github/actions/setup-bun-deps"},
		{"name": "Install kubeconform", "run": "curl -sSL kubeconform && sudo mv kubeconform /usr/local/bin/"},
		{"name": "Install kubescape", "run": "curl -s kubescape/install.sh | /bin/bash"},
		{"name": "Lint K8s", "run": "n-cursor lint k8s --no-fix"},
	]}}}
	some msg in lint_k8s_yml.deny with input as wf with data.template as template_data
	contains(msg, "actions/checkout@v6")
}

test_deny_missing_kubeconform_run if {
	wf := {"jobs": {"lint-k8s": {"steps": [
		{"uses": "actions/checkout@v6", "with": {"persist-credentials": false}},
		{"uses": "./.github/actions/setup-bun-deps"},
		{"name": "Install kubescape", "run": "curl -s kubescape/install.sh | /bin/bash"},
		{"name": "Lint K8s", "run": "n-cursor lint k8s --no-fix"},
	]}}}
	some msg in lint_k8s_yml.deny with input as wf with data.template as template_data
	contains(msg, "kubeconform")
}

test_deny_missing_lint_run if {
	wf := {"jobs": {"lint-k8s": {"steps": [
		{"uses": "actions/checkout@v6", "with": {"persist-credentials": false}},
		{"uses": "./.github/actions/setup-bun-deps"},
		{"name": "Install kubeconform", "run": "curl -sSL kubeconform && sudo mv kubeconform /usr/local/bin/"},
		{"name": "Install kubescape", "run": "curl -s kubescape/install.sh | /bin/bash"},
	]}}}
	some msg in lint_k8s_yml.deny with input as wf with data.template as template_data
	contains(msg, "n-cursor lint k8s --no-fix")
}

test_deny_empty if {
	count(lint_k8s_yml.deny) > 0 with input as {} with data.template as template_data
}
