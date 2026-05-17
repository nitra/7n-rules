package security.gitleaks_test

import data.security.gitleaks
import rego.v1

test_valid_gitleaks if {
	count(gitleaks.deny) == 0 with input as {"extend": {"useDefault": true}}
}

test_missing_use_default if {
	count(gitleaks.deny) == 1 with input as {"title": "local"}
}
