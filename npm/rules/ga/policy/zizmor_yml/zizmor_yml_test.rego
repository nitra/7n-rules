package ga.zizmor_yml

import rego.v1

test_valid_zizmor if {
	count(deny) == 0 with input as {"rules": {"ref-pin": {"config": {"enforce": true}}}}
}

test_missing_ref_pin if {
	count(deny) == 1 with input as {"rules": {"other": true}}
}
