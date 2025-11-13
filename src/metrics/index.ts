import { Type } from '@sinclair/typebox';
import { FastifyPluginCallback } from 'fastify';
import { MediaBridgePool } from '../media_bridge_pool';
import { QoSTelemetryCollector } from './qos';

interface MetricsPluginOptions {
  mediaBridgePool?: MediaBridgePool;
  telemetryCollector?: QoSTelemetryCollector;
}

const MetricsPlugin: FastifyPluginCallback<MetricsPluginOptions> = (
  fastify,
  opts,
  next
) => {
  const telemetry = opts.telemetryCollector;

  fastify.get('/metrics', async (_request, reply) => {
    const payload = telemetry?.toPrometheus(opts.mediaBridgePool) ?? '';
    reply.header('Content-Type', 'text/plain; version=0.0.4');
    reply.send(payload);
  });

  fastify.get('/api/v1/metrics/qos', async (_request, reply) => {
    if (!telemetry) {
      return reply.code(503).send({ error: 'QoS telemetry collector disabled' });
    }
    return reply.send({
      samples: telemetry.getSnapshot(),
      aggregates: telemetry.getAggregates()
    });
  });

  fastify.post<{ Body: {
    sessionId: string;
    mos: number;
    packetLoss: number;
    roundTripTime: number;
    bridgeId?: string;
    productionId?: string;
    lineId?: string;
    direction?: 'ingress' | 'egress';
    observedAt?: number;
  } }>(
    '/api/v1/metrics/qos',
    {
      schema: {
        description: 'Submit client-side WebRTC QoS statistics',
        body: Type.Object({
          sessionId: Type.String(),
          mos: Type.Number(),
          packetLoss: Type.Number(),
          roundTripTime: Type.Number(),
          bridgeId: Type.Optional(Type.String()),
          productionId: Type.Optional(Type.String()),
          lineId: Type.Optional(Type.String()),
          direction: Type.Optional(Type.Union([
            Type.Literal('ingress'),
            Type.Literal('egress')
          ])),
          observedAt: Type.Optional(Type.Number())
        })
      }
    },
    async (request, reply) => {
      if (!telemetry) {
        return reply.code(503).send({ error: 'QoS telemetry collector disabled' });
      }
      telemetry.recordSample(request.body);
      reply.code(202).send({ status: 'accepted' });
    }
  );

  next();
};

export default MetricsPlugin;
