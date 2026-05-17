package js_bun_redis.package_json_test

import data.js_bun_redis.package_json
import rego.v1

template_data := {"deny": {"dependencies": {
	"ioredis": "заміни на Bun native Redis (js-bun-redis.mdc)",
	"node-redis": "заміни на Bun native Redis (js-bun-redis.mdc)",
	"redis": "заміни на Bun native Redis (js-bun-redis.mdc)",
	"@redis/client": "заміни на Bun native Redis (js-bun-redis.mdc)",
}}}

test_allow_no_forbidden if {
	count(package_json.deny) == 0 with input as {"dependencies": {"lodash": "^4.0.0"}}
		with data.template as template_data
}

test_deny_ioredis if {
	some msg in package_json.deny with input as {"dependencies": {"ioredis": "^5.0.0"}}
		with data.template as template_data
	contains(msg, "ioredis")
}

test_deny_redis_subpackage if {
	some msg in package_json.deny with input as {"dependencies": {"@redis/client": "^1.0.0"}}
		with data.template as template_data
	contains(msg, "@redis/client")
}

# Drift test.
test_data_template_drives_deny if {
	some msg in package_json.deny with input as {"dependencies": {"custom-redis": "1.0"}}
		with data.template as {"deny": {"dependencies": {"custom-redis": "заборонено для тесту"}}}
	contains(msg, "custom-redis")
}
