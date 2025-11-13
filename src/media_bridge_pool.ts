import { EventEmitter } from 'events';
import { Log } from './log';

export interface MediaBridgeDefinition {
  id: string;
  baseUrl: string;
  apiKey?: string;
  weight?: number;
  healthCheckPath?: string;
  metadata?: Record<string, string>;
}

export interface BridgeSelectionOptions {
  affinityKey?: string;
  allowUnhealthy?: boolean;
}

export type MediaBridgeHealthState = 'healthy' | 'unhealthy' | 'degraded';

export interface MediaBridgeSnapshot {
  id: string;
  baseUrl: string;
  apiKey?: string;
  weight: number;
  healthy: boolean;
  state: MediaBridgeHealthState;
  lastCheckedAt?: number;
  latencyMs?: number;
  consecutiveFailures: number;
  metadata?: Record<string, string>;
}

class MediaBridgeInstance extends EventEmitter {
  id: string;
  baseUrl: string;
  apiKey: string;
  weight: number;
  healthCheckPath: string;
  metadata: Record<string, string>;
  healthy = true;
  lastCheckedAt?: number;
  lastLatencyMs?: number;
  consecutiveFailures = 0;

  constructor(definition: MediaBridgeDefinition) {
    super();
    this.id = definition.id;
    this.baseUrl = definition.baseUrl.replace(/\/?$/, '/');
    this.apiKey = definition.apiKey || '';
    this.weight = Math.max(1, definition.weight ?? 1);
    this.healthCheckPath = definition.healthCheckPath || 'health';
    this.metadata = definition.metadata || {};
  }

  get state(): MediaBridgeHealthState {
    if (!this.healthy) {
      return 'unhealthy';
    }
    if (this.consecutiveFailures > 0) {
      return 'degraded';
    }
    return 'healthy';
  }

  private getHealthUrl(): string {
    try {
      const url = new URL(this.healthCheckPath, this.baseUrl);
      return url.toString();
    } catch (err) {
      Log().warn(`Invalid health check URL for bridge ${this.id}`, err);
      return this.baseUrl;
    }
  }

  async probe(signal?: AbortSignal): Promise<void> {
    const start = Date.now();
    try {
      const response = await fetch(this.getHealthUrl(), {
        method: 'GET',
        signal,
        headers: {
          ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` })
        }
      });
      this.lastLatencyMs = Date.now() - start;
      this.lastCheckedAt = Date.now();
      if (!response.ok) {
        this.consecutiveFailures += 1;
        if (this.consecutiveFailures > 2) {
          this.healthy = false;
        }
        this.emit('probe', { id: this.id, ok: false });
        return;
      }
      this.consecutiveFailures = 0;
      this.healthy = true;
      this.emit('probe', { id: this.id, ok: true });
    } catch (err) {
      this.lastLatencyMs = Date.now() - start;
      this.lastCheckedAt = Date.now();
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures > 2) {
        this.healthy = false;
      }
      this.emit('probe', { id: this.id, ok: false, error: err });
      Log().warn(`Media bridge probe failed for ${this.id}`, err);
    }
  }

  recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures > 2) {
      this.healthy = false;
    }
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.healthy = true;
  }

  snapshot(): MediaBridgeSnapshot {
    return {
      id: this.id,
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      weight: this.weight,
      healthy: this.healthy,
      state: this.state,
      lastCheckedAt: this.lastCheckedAt,
      latencyMs: this.lastLatencyMs,
      consecutiveFailures: this.consecutiveFailures,
      metadata: this.metadata
    };
  }
}

export interface MediaBridgePoolOptions {
  probeIntervalMs?: number;
}

export class MediaBridgePool {
  private bridges: MediaBridgeInstance[] = [];
  private probeTimer?: NodeJS.Timeout;
  private probeIntervalMs: number;

  constructor(definitions: MediaBridgeDefinition[], options?: MediaBridgePoolOptions) {
    if (!definitions.length) {
      throw new Error('MediaBridgePool requires at least one media bridge definition');
    }
    this.bridges = definitions.map((def) => new MediaBridgeInstance(def));
    this.probeIntervalMs = options?.probeIntervalMs ?? 15_000;
    this.startProbes();
  }

  private startProbes(): void {
    if (this.probeTimer) {
      clearInterval(this.probeTimer);
    }
    this.probeTimer = setInterval(() => {
      void Promise.all(this.bridges.map((bridge) => bridge.probe())).catch((err) =>
        Log().warn('MediaBridgePool probe iteration failed', err)
      );
    }, this.probeIntervalMs);
  }

  getSnapshot(): MediaBridgeSnapshot[] {
    return this.bridges.map((bridge) => bridge.snapshot());
  }

  getBridge(options?: BridgeSelectionOptions): MediaBridgeSnapshot {
    const allowUnhealthy = options?.allowUnhealthy ?? false;
    const healthy = this.bridges.filter((bridge) => bridge.healthy);
    const candidates = healthy.length && !allowUnhealthy ? healthy : this.bridges;
    if (!candidates.length) {
      throw new Error('No media bridges configured');
    }

    let selected: MediaBridgeInstance | undefined;
    if (options?.affinityKey && candidates.length > 1) {
      const hash = this.hash(options.affinityKey);
      const weightSum = candidates.reduce((sum, bridge) => sum + bridge.weight, 0);
      const mod = hash % weightSum;
      let cursor = 0;
      for (const bridge of candidates) {
        cursor += bridge.weight;
        if (mod < cursor) {
          selected = bridge;
          break;
        }
      }
    }

    if (!selected) {
      const totalWeight = candidates.reduce((sum, bridge) => sum + bridge.weight, 0);
      const pick = Math.random() * totalWeight;
      let cursor = 0;
      for (const bridge of candidates) {
        cursor += bridge.weight;
        if (pick <= cursor) {
          selected = bridge;
          break;
        }
      }
    }

    selected = selected || candidates[0];
    return selected.snapshot();
  }

  recordFailure(bridgeId: string): void {
    const bridge = this.bridges.find((b) => b.id === bridgeId);
    bridge?.recordFailure();
  }

  recordSuccess(bridgeId: string): void {
    const bridge = this.bridges.find((b) => b.id === bridgeId);
    bridge?.recordSuccess();
  }

  shutdown(): void {
    if (this.probeTimer) {
      clearInterval(this.probeTimer);
      this.probeTimer = undefined;
    }
  }

  private hash(input: string): number {
    let hash = 0;
    for (let i = 0; i < input.length; i += 1) {
      hash = (hash << 5) - hash + input.charCodeAt(i);
      hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  static fromEnv(params: {
    defaultBaseUrl: string;
    defaultApiKey?: string;
    envJson?: string;
    probeIntervalMs?: number;
  }): MediaBridgePool {
    const definitions: MediaBridgeDefinition[] = [];
    if (params.envJson) {
      try {
        const parsed = JSON.parse(params.envJson);
        if (Array.isArray(parsed)) {
          parsed.forEach((entry, index) => {
            if (!entry?.id || !entry?.baseUrl) {
              throw new Error(
                `Invalid MEDIA_BRIDGES entry at index ${index}: ${JSON.stringify(entry)}`
              );
            }
            definitions.push({
              id: entry.id,
              baseUrl: entry.baseUrl,
              apiKey: entry.apiKey,
              weight: entry.weight,
              healthCheckPath: entry.healthCheckPath,
              metadata: entry.metadata
            });
          });
        }
      } catch (err) {
        Log().warn('Failed to parse MEDIA_BRIDGES env, falling back to defaults', err);
      }
    }

    if (!definitions.length) {
      definitions.push({
        id: 'default',
        baseUrl: params.defaultBaseUrl,
        apiKey: params.defaultApiKey,
        weight: 1
      });
    }

    return new MediaBridgePool(definitions, {
      probeIntervalMs: params.probeIntervalMs
    });
  }
}
