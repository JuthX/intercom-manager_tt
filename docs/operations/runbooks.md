# Operations Runbooks

This directory documents repeatable operational procedures for the intercom manager
platform. The runbooks focus on chaos/failover testing and day-two recovery so SRE
teams can validate the new MediaBridgePool, QoS telemetry collectors, and SIP
integrations under adverse conditions.

## Chaos and Failover Experiments

1. **Media bridge drain test**
   - Scale traffic so at least two bridges are in use.
   - Use the `/api/v1/metrics/qos` endpoint to capture a baseline.
   - Manually block network access to the primary SMB instance (for example
     using `iptables -A OUTPUT -d <bridge-ip> -j DROP`).
   - Observe `intercom_media_bridge_health` via `/metrics` and confirm the pool
     automatically routes new sessions to healthy bridges.
   - Remove the block and ensure the pool recovers (health returns to `1`).

2. **QoS telemetry saturation**
   - Run the WebRTC clients with the `POST /api/v1/metrics/qos` reporting
     enabled and flood the collector at 10x the expected peak rate.
   - Monitor process memory and the Prometheus endpoint for stability.
   - Validate OpenTelemetry/Prometheus scrapes continue to succeed while load is
     applied.

3. **SIP gateway disconnect**
   - Use `/api/v1/sip/dial` to start a PSTN call.
   - Stop FreeSWITCH/Asterisk or block outbound HTTP to the SIP controller.
   - Confirm health checks fail (`/api/v1/sip/health`), PagerDuty alerts fire,
     and calls fail over cleanly.

4. **Recording/transcription pipeline failover**
   - Configure two media pipelines (MediaConnect and Kinesis) on a production.
   - Disable the MediaConnect flow and verify telemetry + runbooks detail how to
     switch to Kinesis or a file-based bucket quickly.

## PagerDuty and Slack Alerts

- `observability` Terraform module provisions PagerDuty services bound to the
  Fastify API and SIP gateway health checks.
- Slack notifications are configured via Grafana contact points to surface QoS
  threshold breaches or unhealthy media bridges.

## Recovery Checklist

1. Pull latest dashboard snapshots from Grafana using `terraform output`.
2. Run `npm run typecheck && npm test` to ensure application consistency after a
   hotfix.
3. Validate MongoDB/CouchDB replication using the built-in health endpoints.
4. Use the runbooks above to rehydrate QoS telemetry after any outage and to
   confirm the MediaBridgePool has recovered from chaos testing.
