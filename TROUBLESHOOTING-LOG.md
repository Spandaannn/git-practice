# Troubleshooting Log — T22

Four incidents covering IAM, networking, container image resolution, and load balancer health checks. Two were deliberately staged; two were real incidents from T18/T19 documented here instead of re-staging, since they were more instructive as genuine mistakes than manufactured ones.

---

## Scenario 1 — IAM: Missing Task Execution Role permissions
**Type:** Deliberately staged

**What broke:** Detached `AmazonECSTaskExecutionRolePolicy` from `ecsTaskExecutionRole`, then forced a new ECS deployment.

**Symptom:** New tasks failed to start. Running tasks were unaffected (already-authenticated), but replacement/new tasks could not.

**Exact error (from task's Stopped reason):**
```
ResourceInitializationError: unable to pull secrets or registry auth: execution resource
retrieval failed: unable to retrieve ecr registry auth: ... AccessDeniedException: User:
arn:aws:sts::285964548929:assumed-role/ecsTaskExecutionRole/... is not authorized to
perform: ecr:GetAuthorizationToken on resource: * because no identity-based policy
allows the ecr:GetAuthorizationToken action
```

**Diagnosis:** The error names the exact API call that failed (`ecr:GetAuthorizationToken`) — the very first step of pulling any image, before even attempting to download image bytes. This confirms the Task Execution Role (distinct from the task's own runtime role, and distinct from any personal IAM user) is what authenticates to ECR and CloudWatch Logs on the task's behalf.

**Fix:** Reattached `AmazonECSTaskExecutionRolePolicy` to `ecsTaskExecutionRole`, forced a new deployment, confirmed 2/2 tasks running successfully.

**Takeaway:** A task can show "running" successfully today and fail tomorrow purely from an IAM policy change elsewhere — the failure surfaces only on the *next* task start attempt, not immediately.

---

## Scenario 2 — Networking: ALB attached to wrong Security Group
**Type:** Real incident (T19), documented here rather than re-staged

**What broke:** When recreating the ECS Service for T19, the "Create new security group" step was skipped/defaulted, so the ALB ended up attached to the VPC's **default** security group — the same one used by an unrelated RDS instance from T15 — which had no HTTP/80 inbound rule.

**Symptom:** `curl` against the ALB's DNS name hung for 2+ minutes and timed out (`curl: (28) Failed to connect ... Could not connect to server`), despite the ECS Service itself showing `2/2 running` and `Deployment status: Success`.

**Diagnosis path:**
1. Checked ECS Service status — tasks running, deployment successful (ruled out app/container-level failure)
2. Checked Target Group health — showed "No targets" at first (still registering)
3. Checked the ALB's own **Security** tab to find its *actual* attached Security Group ID
4. Cross-referenced that ID against Security Groups list — found it was the VPC default group, shared with RDS's PostgreSQL rule, with no HTTP rule at all

**Fix:** Added an inbound rule (HTTP, port 80, source `0.0.0.0/0`) to the correct security group.

**Takeaway:** A healthy Service and a healthy Target Group don't guarantee external reachability — always confirm which Security Group is *actually* attached to the ALB itself, since it's easy to end up on a shared/default group instead of a dedicated one, especially across repeated environment rebuilds.

---

## Scenario 3 — ECS: Stale cached image digest
**Type:** Real incident (T19), documented here rather than re-staged

**What broke:** A Task Definition revision was created referencing `:latest`, but ECS resolved and cached a specific image digest at that moment. The underlying image was later rebuilt and re-pushed under the same `:latest` tag (for an unrelated change — adding logging). The old digest no longer existed in ECR.

**Symptom:** Tasks failed to start with `CannotPullContainerError`, and `curl` against the ALB hung with no response (target health showed no healthy targets).

**Exact error:**
```
CannotPullContainerError: pull image manifest has been retried 7 time(s): failed to
resolve ref .../ecs-practice-app:<64-char-digest-string>: ... not found
```

**Diagnosis:** The referenced tag in the error wasn't `:latest` as expected — it was a specific digest hash, confirming the Task Definition had resolved and cached a digest rather than genuinely re-checking `:latest` at each deploy.

**Fix:** Created a brand-new Task Definition revision (forcing a fresh tag resolution) rather than reusing the stale one, and updated the Service to use it. Confirmed the new revision's digest matched the currently-tagged `:latest` image via `aws ecr describe-images`.

**Takeaway:** `:latest` is not a live pointer that ECS re-checks on every deploy — a Task Definition revision can carry a resolved-and-cached digest from creation time. Always create a new revision (not reuse an old one) when you need to guarantee the newest image is actually pulled; tagging by commit SHA (as done in T18) avoids this ambiguity entirely.

---

## Scenario 4 — ALB: Health check path change had no effect
**Type:** Deliberately staged, with an unexpected (more instructive) real result

**What was attempted:** Changed the target group's health check path from `/` to `/nonexistent-path`, expecting targets to flip to Unhealthy within 1-2 health check cycles (30s interval, 2-failure threshold).

**What actually happened:** Targets remained `2 Healthy` indefinitely — no change even after 15+ minutes, well past the expected window.

**Diagnosis:**
```bash
curl -I http://<alb-dns>/nonexistent-path
# HTTP/1.1 200 OK
```
The app itself has no routing logic — every request, on any path, returns `200 OK` unconditionally. The health check's success criterion (`200`) was met regardless of path, so it never had a chance to fail.

**Fix:** Reverted the health check path back to `/` (no actual fix needed for the app, since this wasn't a real outage — reverted purely to restore the intended baseline config).

**Takeaway:** A health check is only as meaningful as the application's own response logic. Because this app returns `200` for every path with no real routing or error handling, the health check can never distinguish "genuinely healthy" from "server merely accepting connections" — a more realistic app would need explicit route handling (404 for unmatched paths, proper error codes on failure) for its health check to carry real signal. This is a more useful finding than the originally staged scenario, since it surfaced a genuine gap in the app itself rather than just proving the health check mechanism works.

---

## Cross-scenario observations
- Two of the four "troubleshooting scenarios" were real incidents encountered organically during T18/T19, not staged — suggesting these failure categories (IAM permission gaps, Security Group misconfiguration, stale image references) are genuinely common, not contrived for this exercise.
- In every case, the AWS Console's own error text (Stopped reason, curl output, target health status) was sufficient to diagnose the root cause without needing external documentation — the discipline of reading the *exact* error text carefully, rather than pattern-matching to a remembered fix, was consistently the deciding factor in diagnosing correctly.
