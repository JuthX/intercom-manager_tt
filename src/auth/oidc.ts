import { AuthenticatedUser } from './rbac';

export interface OidcAuthOptions {
  issuer: string;
  clientId: string;
  audience?: string;
}

export class OidcProvider {
  constructor(private readonly options: OidcAuthOptions) {}

  async authenticate(token: string): Promise<AuthenticatedUser | null> {
    // In this mocked environment, treat the token as base64 JSON
    try {
      const payload = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
      if (!payload.sub) return null;
      const scopes = Array.isArray(payload.scopes)
        ? payload.scopes
        : typeof payload.scope === 'string'
        ? payload.scope.split(' ').filter(Boolean)
        : [];
      return {
        id: payload.sub,
        organizationId: payload.org,
        scopes,
        roles: payload.roles ?? [],
        provider: 'oidc',
        metadata: { issuer: this.options.issuer }
      };
    } catch (error) {
      return null;
    }
  }
}
