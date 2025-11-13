# Terraform Observability Stack

The `observability` module deploys kube-prometheus-stack, Grafana dashboards, and
wires alerting into PagerDuty and Slack. It can run alongside the existing AWS
and Eyevinn OSC examples without modification.

```hcl
module "observability" {
  source                     = "./modules/observability"
  namespace                  = var.observability_namespace
  grafana_admin_password     = var.grafana_admin_password
  pagerduty_service_name     = var.pagerduty_service_name
  pagerduty_integration_key  = var.pagerduty_integration_key
  slack_webhook_url          = var.slack_webhook_url
}
```

After `terraform apply`:

- Scrape `/metrics` for QoS + MediaBridgePool statistics.
- Use the generated Grafana dashboards to monitor MOS, RTT, and health probes.
- PagerDuty receives Events API v2 alerts from Prometheus Alertmanager.
- Slack receives Grafana alerts for warning-level QoS degradations.
