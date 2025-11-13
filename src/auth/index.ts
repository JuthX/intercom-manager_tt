import { FastifyInstance } from 'fastify';
import { DbManager } from '../db/interface';
import { RoleScope } from '../models';
import { AuthenticatedUser, requireScopes } from './rbac';
import { OidcProvider, OidcAuthOptions } from './oidc';
import { SamlProvider, SamlAuthOptions } from './saml';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

export interface AuthModuleOptions {
  allowAnonymous?: boolean;
  defaultScopes?: RoleScope[];
  oidc?: OidcAuthOptions;
  saml?: SamlAuthOptions;
}

export interface InternalAuthOptions extends AuthModuleOptions {
  dbManager: DbManager;
}

function parseSimpleToken(token: string): AuthenticatedUser | null {
  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if (decoded && decoded.id && decoded.scopes) {
      return {
        id: decoded.id,
        scopes: decoded.scopes,
        roles: decoded.roles ?? [],
        organizationId: decoded.organizationId,
        provider: decoded.provider ?? 'token'
      };
    }
  } catch (error) {
    // ignore
  }
  const normalized = token.toLowerCase();
  if (['admin', 'engineer', 'operator', 'talent'].includes(normalized)) {
    return {
      id: `${normalized}-token`,
      scopes: [normalized as RoleScope],
      roles: [],
      provider: 'token'
    };
  }
  return null;
}

export async function registerAuth(
  fastify: FastifyInstance,
  options: InternalAuthOptions
) {
  const oidcProvider = options.oidc ? new OidcProvider(options.oidc) : null;
  const samlProvider = options.saml ? new SamlProvider(options.saml) : null;

  fastify.addHook('onRequest', async (request, reply) => {
    const header = request.headers['authorization'];
    const bearer = Array.isArray(header) ? header[0] : header;

    const allowAnonymous = options.allowAnonymous ?? false;
    if (!bearer) {
      if (allowAnonymous) {
        request.user = {
          id: 'anonymous',
          scopes: options.defaultScopes ?? [],
          roles: [],
          provider: 'anonymous'
        };
        return;
      }
      reply.code(401).send({ message: 'Missing Authorization header' });
      return;
    }

    const token = bearer.replace(/^Bearer\s+/i, '').trim();
    let user: AuthenticatedUser | null = null;
    if (token.startsWith('oidc.')) {
      user = (await oidcProvider?.authenticate(token.slice(5))) ?? null;
    } else if (token.startsWith('saml.')) {
      user = (await samlProvider?.authenticate(token.slice(5))) ?? null;
    } else {
      user = parseSimpleToken(token);
    }

    if (!user) {
      if (allowAnonymous) {
        request.user = {
          id: 'anonymous',
          scopes: options.defaultScopes ?? [],
          roles: [],
          provider: 'anonymous'
        };
        return;
      }
      reply.code(401).send({ message: 'Invalid credentials' });
      return;
    }

    request.user = user;
  });
}

export { requireScopes };
