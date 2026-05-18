package js_run.package_json_test

import data.js_run.package_json
import rego.v1

template_data := {"deny": {
	"dependencies": {
		"bunyan": "використовуй стандартні логери (js-run.mdc)",
		"@nitra/bunyan": "використовуй стандартні логери (js-run.mdc)",
	},
	"devDependencies": {
		"bunyan": "використовуй стандартні логери (js-run.mdc)",
		"@nitra/bunyan": "використовуй стандартні логери (js-run.mdc)",
	},
	"scriptsForbidden": [
		{
			"id": "node-runner",
			"pattern": `\bnode(\s|$)`,
			"message": "заміни `node` на `bun` у scripts — один runtime у dev і prod (js-run.mdc)",
		},
		{
			"id": "env-cat-bun",
			"pattern": `\benv\s+\$\(cat\s+[^)]+\)\s+bun\b`,
			"message": "заміни `env $(cat A B) bun` на `bun --env-file=A --env-file=B` (нативний Bun, js-run.mdc)",
		},
	],
}}

test_allow_clean if {
	count(package_json.deny) == 0 with input as {"dependencies": {"lodash": "^4.0.0"}}
		with data.template as template_data
}

test_deny_bunyan_in_deps if {
	some msg in package_json.deny with input as {"dependencies": {"bunyan": "^1.0.0"}}
		with data.template as template_data
	contains(msg, "bunyan")
}

test_deny_nitra_bunyan_in_devdeps if {
	some msg in package_json.deny with input as {"devDependencies": {"@nitra/bunyan": "^1.0.0"}}
		with data.template as template_data
	contains(msg, "@nitra/bunyan")
}

# Drift test.
test_data_template_drives_deny if {
	some msg in package_json.deny with input as {"dependencies": {"custom-log": "1.0"}}
		with data.template as {"deny": {"dependencies": {"custom-log": "заборонено для тесту"}}}
	contains(msg, "custom-log")
}

test_deny_node_in_scripts if {
	some msg in package_json.deny with input as {"scripts": {"start": "node src/index.js"}}
		with data.template as template_data
	contains(msg, "scripts.start")
	contains(msg, "bun")
}

test_allow_bun_in_scripts if {
	count(package_json.deny) == 0 with input as {"scripts": {"start": "bun src/index.js"}}
		with data.template as template_data
}

test_allow_node_in_scripts_when_vite_frontend if {
	count(package_json.deny) == 0 with input as {
		"devDependencies": {"vite": "^8.0.0"},
		"scripts": {"start": "node legacy-build.js"},
	}
		with data.template as template_data
}

test_deny_node_runner_template_drift if {
	some msg in package_json.deny with input as {"scripts": {"start": "node app.js"}}
		with data.template as {"deny": {"scriptsForbidden": [{
			"id": "node-runner",
			"pattern": `\bnode(\s|$)`,
			"message": "DRIFT_TEST_MESSAGE",
		}]}}
	contains(msg, "DRIFT_TEST_MESSAGE")
}

test_deny_env_cat_bun_in_scripts if {
	some msg in package_json.deny with input as {
		"scripts": {"start": "env $(cat .env .env.local) bun src/index.js"},
	}
		with data.template as template_data
	contains(msg, "scripts.start")
	contains(msg, "--env-file")
}

test_allow_bun_env_file_in_scripts if {
	count(package_json.deny) == 0 with input as {
		"scripts": {"start": "bun --env-file=.env --env-file=.env.local src/index.js"},
	}
		with data.template as template_data
}

test_allow_env_cat_bun_when_vite_frontend if {
	count(package_json.deny) == 0 with input as {
		"devDependencies": {"vite": "^8.0.0"},
		"scripts": {"start": "env $(cat .env) bun run dev"},
	}
		with data.template as template_data
}

test_deny_env_cat_bun_template_drift if {
	some msg in package_json.deny with input as {
		"scripts": {"dev": "env $(cat .env) bun --watch src/index.js"},
	}
		with data.template as {"deny": {"scriptsForbidden": [{
			"id": "env-cat-bun",
			"pattern": `\benv\s+\$\(cat\s+[^)]+\)\s+bun\b`,
			"message": "DRIFT_ENV_CAT_BUN",
		}]}}
	contains(msg, "DRIFT_ENV_CAT_BUN")
}
