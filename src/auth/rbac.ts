import { FastifyReply, FastifyRequest } from 'fastify';
import { RoleScope } from '../models';

export interface AuthenticatedUser {
  id: string;
  organizationId?: string;
  roles: string[];
  scopes: RoleScope[];
  provider?: string;
  metadata?: Record<string, unknown>;
}

export function hasRequiredScopes(
  user: AuthenticatedUser | undefined,
  required: RoleScope[]
): boolean {
  if (!user) return false;
  if (required.length === 0) return true;
  return required.some((scope) => user.scopes?.includes(scope));
}

export function requireScopes(scopes: RoleScope | RoleScope[]) {
  const required = Array.isArray(scopes) ? scopes : [scopes];
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!hasRequiredScopes(request.user, required)) {
      reply.code(403).send({ message: 'Insufficient scope' });
      return;
    }
  };
}
