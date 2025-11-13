import { AuthenticatedUser } from './rbac';

export interface SamlAuthOptions {
  entityId: string;
  audience?: string;
}

export class SamlProvider {
  constructor(private readonly options: SamlAuthOptions) {}

  async authenticate(assertion: string): Promise<AuthenticatedUser | null> {
    try {
      const decoded = Buffer.from(assertion, 'base64').toString('utf8');
      const json = JSON.parse(decoded);
      return {
        id: json.nameId ?? 'saml-user',
        organizationId: json.org,
        scopes: json.scopes ?? [],
        roles: json.roles ?? [],
        provider: 'saml',
        metadata: { entityId: this.options.entityId }
      };
    } catch (error) {
      return null;
    }
  }
}
