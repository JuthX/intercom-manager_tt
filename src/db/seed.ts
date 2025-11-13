import { DbManager } from './interface';
import { Role } from '../models';

const CORE_ROLES: Role[] = [
  {
    _id: 'role-admin',
    name: 'Administrator',
    scope: 'admin',
    description: 'Full control over productions and infrastructure',
    permissions: [
      'production:full',
      'ingest:full',
      'automation:full',
      'config:full'
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    _id: 'role-engineer',
    name: 'Engineer',
    scope: 'engineer',
    description: 'Manage technical workflows and signal graphs',
    permissions: [
      'production:edit',
      'preset:edit',
      'automation:read',
      'config:deploy'
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    _id: 'role-operator',
    name: 'Operator',
    scope: 'operator',
    description: 'Operate shows using approved presets',
    permissions: ['production:operate', 'preset:apply'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    _id: 'role-talent',
    name: 'Talent',
    scope: 'talent',
    description: 'Talent and guests with restricted access',
    permissions: ['panel:use'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

export async function seedReferenceData(dbManager: DbManager): Promise<void> {
  const existingRoles = await dbManager.listRoles();
  const roleScopes = new Set(existingRoles.map((r) => r.scope));
  for (const role of CORE_ROLES) {
    if (!roleScopes.has(role.scope)) {
      await dbManager.upsertRole({
        ...role,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
  }

  const organizations = await dbManager.listOrganizations();
  if (organizations.length === 0) {
    const adminRole = await dbManager.getRoleByScope('admin');
    await dbManager.createOrganization({
      _id: 'org-default',
      name: 'Global Production',
      slug: 'global-production',
      domains: [],
      defaultRoleIds: adminRole ? [adminRole._id] : [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
}
