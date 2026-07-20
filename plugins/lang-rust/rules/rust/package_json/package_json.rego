# Перевірка `package.json` для Rust-проєктів (rust.mdc / lint.mdc).
#
# `cargo`, `rustfmt`, `clippy` — частина Rust toolchain (rustup), не npm-залежностей.
# Вони мають бути у PATH через `rustup` локально або `dtolnay/rust-toolchain@stable` у CI.
package rust.package_json

import rego.v1

banned_rust_tools := {"cargo", "rustfmt", "clippy"}

deny contains msg if {
	some field in {"dependencies", "devDependencies", "peerDependencies"}
	deps := object.get(input, field, {})
	some name, _ in deps
	name in banned_rust_tools
	msg := sprintf(
		"package.json: %s.%s заборонений — Rust toolchain встановлюється через rustup / dtolnay/rust-toolchain@stable, не через npm (rust.mdc)",
		[field, name],
	)
}
