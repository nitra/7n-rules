package python.pyproject_toml_test

import data.python.pyproject_toml
import rego.v1

# Mirrors template/pyproject.toml.deny.toml
template_data := {"deny": {"tool": {"poetry": "Poetry заборонено: мігруй на uv + PEP 621 [project] (python.mdc)"}}}

valid_pep621 := {
	"project": {
		"name": "demo",
		"version": "1.0.0",
		"requires-python": ">=3.12",
		"dependencies": [],
	},
}

test_allow_pep621 if {
	count(pyproject_toml.deny) == 0 with input as valid_pep621 with data.template as template_data
}

test_allow_pep621_with_uv_tool if {
	count(pyproject_toml.deny) == 0 with input as {
		"project": {
			"name": "demo",
			"version": "1.0.0",
			"requires-python": ">=3.12",
			"dependencies": [],
		},
		"tool": {"uv": {"dev-dependencies": ["ruff"]}, "ruff": {"line-length": 120}},
	}
		with data.template as template_data
}

test_deny_tool_poetry if {
	some msg in pyproject_toml.deny with input as {
		"project": {"name": "demo", "version": "1.0.0"},
		"tool": {"poetry": {"name": "demo"}},
	}
		with data.template as template_data
	contains(msg, "Poetry")
}

test_deny_missing_name if {
	some msg in pyproject_toml.deny with input as {"project": {"version": "1.0.0"}}
		with data.template as template_data
	contains(msg, "name")
}

test_deny_missing_version if {
	some msg in pyproject_toml.deny with input as {"project": {"name": "demo"}}
		with data.template as template_data
	contains(msg, "version")
}

test_deny_missing_requires_python if {
	some msg in pyproject_toml.deny
		with input as {"project": {"name": "demo", "version": "1.0.0", "dependencies": []}}
		with data.template as template_data
	contains(msg, "requires-python")
}

test_deny_missing_dependencies if {
	some msg in pyproject_toml.deny
		with input as {"project": {"name": "demo", "version": "1.0.0", "requires-python": ">=3.12"}}
		with data.template as template_data
	contains(msg, "dependencies")
}

test_allow_empty_dependencies_list if {
	count(pyproject_toml.deny) == 0
		with input as {"project": {"name": "demo", "version": "1.0.0", "requires-python": ">=3.12", "dependencies": []}}
		with data.template as template_data
}

test_deny_empty if {
	count(pyproject_toml.deny) > 0 with input as {} with data.template as template_data
}

# Drift test: deny-template веде перелік заборонених `tool`-підтаблиць.
test_data_template_drives_forbidden_tool if {
	some msg in pyproject_toml.deny with input as {
		"project": {"name": "demo", "version": "1.0.0"},
		"tool": {"flit": {}},
	}
		with data.template as {"deny": {"tool": {"flit": "DRIFT_FORBIDDEN_TOOL"}}}
	contains(msg, "DRIFT_FORBIDDEN_TOOL")
}
