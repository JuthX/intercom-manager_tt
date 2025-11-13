import { Type } from '@sinclair/typebox';
import { FastifyPluginCallback } from 'fastify';
import { SipGateway } from './index';

export interface SipGatewayApiOptions {
  sipGateway: SipGateway;
}

const SipGatewayApi: FastifyPluginCallback<SipGatewayApiOptions> = (
  fastify,
  opts,
  next
) => {
  fastify.post<{ Body: { conferenceId: string; phoneNumber: string; callerId?: string } }>(
    '/api/v1/sip/dial',
    {
      schema: {
        description: 'Initiate a PSTN/SIP dial-out into a conference',
        body: Type.Object({
          conferenceId: Type.String(),
          phoneNumber: Type.String(),
          callerId: Type.Optional(Type.String())
        })
      }
    },
    async (request, reply) => {
      const payload = await opts.sipGateway.dial({
        conferenceId: request.body.conferenceId,
        phoneNumber: request.body.phoneNumber,
        callerId: request.body.callerId
      });
      reply.code(202).send(payload);
    }
  );

  fastify.delete<{ Params: { callId: string } }>(
    '/api/v1/sip/call/:callId',
    {
      schema: {
        description: 'Hang up a PSTN/SIP dial-out session',
        params: Type.Object({ callId: Type.String() })
      }
    },
    async (request, reply) => {
      await opts.sipGateway.hangup(request.params.callId);
      reply.code(204).send();
    }
  );

  fastify.get('/api/v1/sip/health', async (_request, reply) => {
    const ok = await opts.sipGateway.healthCheck();
    reply.send({ healthy: ok });
  });

  next();
};

export default SipGatewayApi;
