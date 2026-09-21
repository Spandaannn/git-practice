# Monitoring & Logging Setup — ECS practice-service

## Logging
- Log group: `/ecs/practice-task`
- Driver: `awslogs` (built into ECS/Fargate, no agent install needed)
- Captures: application stdout, including a per-request log line
  (`Request received: <method> <url> at <timestamp>`)
- Confirmed working by generating traffic via curl and Apache Bench,
  and verifying log lines appeared in the CloudWatch console.

## Metrics tracked
1. **ECS Service CPUUtilization** (AWS/ECS namespace)
   - Why: aggregate resource pressure across all running tasks
   - Alarm: `HighCPU-ECSService`, threshold >70%, 5-minute period

2. **ALB TargetResponseTime** (AWS/ApplicationELB namespace)
   - Why: catches degraded user experience even when requests
     still succeed (a 200 response can still be too slow)
   - Alarm: `ALB-SlowResponse`, threshold >1 second average, 5-minute period

## Notifications
- SNS topic: `ecs-cpu-alert`
- Subscriber: [your email]
- Both alarms route to this same topic

## Load test results (Apache Bench, 5000 requests, 50 concurrent)
- 0 failed requests
- Mean response time: 733ms
- 50th percentile: 216ms | 99th percentile: 4221ms | max: 35,853ms
- Neither alarm triggered during this test — see note below

## Observation: why the alarms didn't fire despite real slowdowns
The `ab` load test ran for only ~73 seconds, but both alarms evaluate
on a 5-minute period using an AVERAGE statistic. A short burst of high
latency gets diluted by the surrounding idle time within that same
5-minute window, so the average never crossed either threshold — even
though individual requests were clearly slow (up to 35 seconds at the
99th+ percentile). This is a real limitation of average-based,
long-period alarms: they can miss short, sharp problems that raw
request-level data reveals immediately. A more sensitive setup would
use a shorter period, a percentile-based statistic (e.g. p99 instead
of Average), or both.

## EC2 (T12) vs ECS (T19) logging — comparison
On EC2, shipping logs required installing the CloudWatch Agent
manually, writing a config file by hand, and — critically — attaching
a dedicated IAM Role to the instance itself, separate from any
personal IAM user. Without that role, the agent silently failed
(status showed "running" even while every log-shipping attempt
errored with a credentials failure).

On ECS/Fargate, logging is declared directly in the Task Definition
(`awslogs` driver, log group name, region) — no agent to install, no
separate IAM role to attach, since the Task's execution role already
covers it. For a real project, I'd prefer the ECS/Fargate approach
whenever containerizing is already the plan, since it removes an
entire category of setup and a common failure mode I hit firsthand.

## If paged by the CPU alarm at 2am, in order I'd check:
1. CloudWatch Logs (`/ecs/practice-task`) for error patterns or a
   spike in request volume around the alarm time
2. ECS Service's Deployments tab — was a deployment in progress
   (new tasks starting, old ones draining) that would explain a
   temporary CPU spike?
3. ALB target health — are tasks actually healthy, or is the
