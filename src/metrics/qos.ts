import { MediaBridgePool } from '../media_bridge_pool';

export interface QoSSample {
  sessionId: string;
  mos: number;
  packetLoss: number;
  roundTripTime: number;
  bridgeId?: string;
  productionId?: string;
  lineId?: string;
  direction?: 'ingress' | 'egress';
  observedAt: number;
}

export interface QoSAggregateMetrics {
  averageMos: number;
  averagePacketLoss: number;
  averageRtt: number;
  sampleCount: number;
}

export class QoSTelemetryCollector {
  private samples: Map<string, QoSSample> = new Map();

  recordSample(sample: Omit<QoSSample, 'observedAt'> & { observedAt?: number }): void {
    const normalized: QoSSample = {
      ...sample,
      observedAt: sample.observedAt ?? Date.now()
    };
    this.samples.set(normalized.sessionId, normalized);
  }

  dropSample(sessionId: string): void {
    this.samples.delete(sessionId);
  }

  getSnapshot(): QoSSample[] {
    return Array.from(this.samples.values());
  }

  getAggregates(): QoSAggregateMetrics {
    const samples = this.getSnapshot();
    if (!samples.length) {
      return { averageMos: 0, averagePacketLoss: 0, averageRtt: 0, sampleCount: 0 };
    }
    const totals = samples.reduce(
      (acc, sample) => {
        acc.mos += sample.mos;
        acc.packetLoss += sample.packetLoss;
        acc.rtt += sample.roundTripTime;
        return acc;
      },
      { mos: 0, packetLoss: 0, rtt: 0 }
    );
    return {
      averageMos: totals.mos / samples.length,
      averagePacketLoss: totals.packetLoss / samples.length,
      averageRtt: totals.rtt / samples.length,
      sampleCount: samples.length
    };
  }

  toPrometheus(pool?: MediaBridgePool): string {
    const lines: string[] = [];
    const aggregates = this.getAggregates();
    lines.push('# HELP intercom_webrtc_mos_mean Mean MOS across active sessions');
    lines.push('# TYPE intercom_webrtc_mos_mean gauge');
    lines.push(`intercom_webrtc_mos_mean ${aggregates.averageMos.toFixed(3)}`);

    lines.push('# HELP intercom_webrtc_packet_loss_mean Packet loss percentage');
    lines.push('# TYPE intercom_webrtc_packet_loss_mean gauge');
    lines.push(
      `intercom_webrtc_packet_loss_mean ${aggregates.averagePacketLoss.toFixed(5)}`
    );

    lines.push('# HELP intercom_webrtc_rtt_mean Round trip time in milliseconds');
    lines.push('# TYPE intercom_webrtc_rtt_mean gauge');
    lines.push(`intercom_webrtc_rtt_mean ${aggregates.averageRtt.toFixed(3)}`);

    lines.push('# HELP intercom_webrtc_active_sessions Number of sessions reporting QoS');
    lines.push('# TYPE intercom_webrtc_active_sessions gauge');
    lines.push(`intercom_webrtc_active_sessions ${aggregates.sampleCount}`);

    if (pool) {
      lines.push('# HELP intercom_media_bridge_health Media bridge health status');
      lines.push('# TYPE intercom_media_bridge_health gauge');
      pool.getSnapshot().forEach((bridge) => {
        const value = bridge.healthy ? 1 : 0;
        const labels = [`bridge_id="${bridge.id}"`, `base_url="${bridge.baseUrl}"`];
        lines.push(`intercom_media_bridge_health{${labels.join(',')}} ${value}`);
        if (typeof bridge.latencyMs === 'number') {
          lines.push('# HELP intercom_media_bridge_latency_ms Health probe latency');
          lines.push('# TYPE intercom_media_bridge_latency_ms gauge');
          lines.push(
            `intercom_media_bridge_latency_ms{${labels.join(',')}} ${bridge.latencyMs}`
          );
        }
      });
    }

    return `${lines.join('\n')}\n`;
  }
}
