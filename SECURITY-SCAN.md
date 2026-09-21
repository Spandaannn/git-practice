# Security Scan — ecs-practice-app

## Summary
- OS (Alpine 3.23.4): 4 findings, all HIGH, 0 CRITICAL
- Node.js packages: 20 findings, 19 HIGH, 1 CRITICAL

## Key finding: npm tooling vs. application dependencies
Nearly all Node.js findings are under usr/local/lib/node_modules/npm/... —
npm's own bundled internal tooling (shipped inside the base image), not
this app's actual dependency (pg). The 1 CRITICAL (tar, CVE-2026-59873)
falls in this category: reachable only during `docker build`/npm's own
internal operations, not at runtime. Real risk to this running app: low.

## Runtime-relevant findings (worth tracking)
libcrypto3 / libssl3 (OpenSSL), 4 HIGH findings — these ARE used at
runtime (TLS connections to RDS). Fixed versions (3.5.7-r0/3.5.8-r0)
are published upstream but not yet available in Alpine 3.23's package
repos as of this scan. Confirmed by rebuilding against `alpine3.23`
explicitly — resolved to the identical image digest, no change.
Remediation path: wait for Alpine to backport the fix into 3.23, or
move to a newer Alpine release once available.

## Takeaway
"Fixed version exists" in scanner output doesn't always mean "available
right now for your current base image" — worth re-checking periodically
rather than treating a scan as a one-time gate.
