# Тести `abie.package_json_docs`. Запуск:
#   conftest verify -p npm/rules/abie/policy/package_json_docs
package abie.package_json_docs_test

import data.abie.package_json_docs
import rego.v1

test_allow_present if {
	pkg := {"devDependencies": {"@nitra/abie-docs": "^1.0.0"}}
	count(package_json_docs.deny) == 0 with input as pkg
}

test_allow_present_with_other_devdeps if {
	pkg := {"devDependencies": {"@nitra/abie-docs": "1.2.3", "vite": "^5.0.0"}}
	count(package_json_docs.deny) == 0 with input as pkg
}

test_deny_missing_devdeps_block if {
	count(package_json_docs.deny) > 0 with input as {"name": "x"}
}

test_deny_empty_devdeps if {
	count(package_json_docs.deny) > 0 with input as {"devDependencies": {}}
}

test_deny_only_in_dependencies if {
	pkg := {"dependencies": {"@nitra/abie-docs": "^1.0.0"}}
	count(package_json_docs.deny) > 0 with input as pkg
}
