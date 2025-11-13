import { randomUUID } from 'crypto';
import { Log } from '../log';
import {
  AutomationHook,
  ChannelPreset,
  Device,
  Ingest,
  Line,
  NewIngest,
  Organization,
  PanelLayout,
  Production,
  Role,
  User,
  UserSession
} from '../models';
import { assert } from '../utils';
import { DbManager } from './interface';
import nano from 'nano';

export class DbManagerCouchDb implements DbManager {
  private client;
  private nanoDb: nano.DocumentScope<unknown> | undefined;
  private dbConnectionUrl: URL;
  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-');
  }

  private nowIso(): string {
    return new Date().toISOString();
  }

  private async upsertDoc<T>(doc: Record<string, unknown>): Promise<T> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }
    let existing;
    try {
      existing = await this.nanoDb.get(doc._id as string);
    } catch (error: any) {
      if (error?.statusCode !== 404) {
        throw error;
      }
    }
    const payload = existing ? { ...existing, ...doc } : doc;
    const response = await this.nanoDb.insert(payload as nano.MaybeDocument);
    if (!response.ok) {
      throw new Error('Failed to persist document');
    }
    return payload as T;
  }

  private async deleteDoc(id: string): Promise<boolean> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }
    try {
      const existing = await this.nanoDb.get(id);
      const response = await this.nanoDb.destroy(existing._id, existing._rev);
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  private async findDocs<T>(selector: Record<string, unknown>): Promise<T[]> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }
    const response = await this.nanoDb.find({ selector });
    return response.docs as unknown as T[];
  }

  private async getDoc<T>(id: string): Promise<T | null> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }
    try {
      const doc = await this.nanoDb.get(id);
      return doc as any as T;
    } catch (error: any) {
      if (error?.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  constructor(dbConnectionUrl: URL) {
    this.dbConnectionUrl = dbConnectionUrl;
    const server = new URL('/', this.dbConnectionUrl).toString();
    this.client = nano(server);
  }

  async connect(): Promise<void> {
    if (!this.nanoDb) {
      const dbList = await this.client.db.list();
      Log().debug('List of databases', dbList);
      const dbName = this.dbConnectionUrl.pathname.replace(/^\//, '');
      if (!dbList.includes(dbName)) {
        Log().info('Creating database', dbName);
        await this.client.db.create(dbName);
      }
      Log().info('Using database', dbName);
      this.nanoDb = this.client.db.use(
        this.dbConnectionUrl.pathname.replace(/^\//, '')
      );

      const ensureIndex = async (fields: string[], name: string) => {
        if (!this.nanoDb) return;
        try {
          await this.nanoDb.createIndex({
            index: { fields },
            name,
            type: 'json'
          });
        } catch (err: any) {
          if (err?.statusCode !== 409) {
            Log().warn('Failed to create index %s: %s', name, err?.message || err);
          }
        }
      };

      await ensureIndex(['docType'], 'doctype-index');
      await ensureIndex(['docType', 'organizationId'], 'doctype-org-index');
      await ensureIndex(['docType', 'productionId'], 'doctype-prod-index');
    }
  }

  async disconnect(): Promise<void> {
    // CouchDB does not require a disconnection
  }

  private async getNextSequence(collectionName: string): Promise<number> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }
    const counterDocId = `counter_${collectionName}`;
    interface CounterDoc {
      _id: string;
      _rev?: string;
      value: string;
    }
    let counterDoc: CounterDoc;

    try {
      counterDoc = (await this.nanoDb.get(counterDocId)) as CounterDoc;
      counterDoc.value = (parseInt(counterDoc.value) + 1).toString();
    } catch (error) {
      counterDoc = { _id: counterDocId, value: '1' };
    }
    await this.nanoDb.insert(counterDoc);
    return parseInt(counterDoc.value, 10);
  }

  /** Get all productions from the database in reverse natural order, limited by the limit parameter */
  async getProductions(limit: number, offset: number): Promise<Production[]> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }
    const productions: Production[] = [];
    const response = await this.nanoDb.list({
      include_docs: true
    });
    // eslint-disable-next-line
    response.rows.forEach((row: any) => {
      if (
        row.doc._id.toLowerCase().indexOf('counter') === -1 &&
        row.doc._id.toLowerCase().indexOf('session_') === -1
      )
        productions.push(row.doc);
    });

    // Apply offset and limit
    const result = productions.slice(offset, offset + limit);
    return result as any as Production[];
  }

  async getProductionsLength(): Promise<number> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }
    const productions = await this.nanoDb.list({ include_docs: false });
    // Filter out counter and session documents
    const filteredRows = productions.rows.filter(
      (row: any) =>
        row.id.toLowerCase().indexOf('counter') === -1 &&
        row.id.toLowerCase().indexOf('session_') === -1
    );
    return filteredRows.length;
  }

  async getProduction(id: number): Promise<Production | undefined> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    const production = await this.nanoDb.get(id.toString());
    // eslint-disable-next-line
    return production as any | undefined;
  }

  async updateProduction(
    production: Production
  ): Promise<Production | undefined> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    const existingProduction = await this.nanoDb.get(production._id.toString());
    const updatedProduction = {
      ...existingProduction,
      ...production,
      _id: production._id.toString()
    };
    const response = await this.nanoDb.insert(updatedProduction);
    return response.ok ? production : undefined;
  }

  async addProduction(name: string, lines: Line[]): Promise<Production> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    const _id = await this.getNextSequence('productions');
    if (_id === -1) {
      throw new Error('Failed to get next sequence');
    }
    const insertProduction = { name, lines, _id: _id.toString() };
    const response = await this.nanoDb.insert(
      insertProduction as unknown as nano.MaybeDocument
    );
    if (!response.ok) throw new Error('Failed to insert production');
    return { name, lines, _id } as Production;
  }

  async deleteProduction(productionId: number): Promise<boolean> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    const production = await this.nanoDb.get(productionId.toString());
    const response = await this.nanoDb.destroy(production._id, production._rev);
    return response.ok;
  }

  async setLineConferenceId(
    productionId: number,
    lineId: string,
    conferenceId: string
  ): Promise<void> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    const production = await this.getProduction(productionId);
    assert(production, `Production with id "${productionId}" does not exist`);
    const line = production.lines.find((line) => line.id === lineId);
    assert(
      line,
      `Line with id "${lineId}" does not exist for production with id "${productionId}"`
    );
    line.smbConferenceId = conferenceId;
    const existingProduction = await this.nanoDb.get(productionId.toString());
    const updatedProduction = {
      ...existingProduction,
      lines: production.lines
    };
    const response = await this.nanoDb.insert(updatedProduction);
    assert(
      response.ok,
      `Failed to update production with id "${productionId}"`
    );
  }

  async addIngest(newIngest: NewIngest): Promise<Ingest> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    const _id = await this.getNextSequence('ingests');
    if (_id === -1) {
      throw new Error('Failed to get next sequence');
    }
    const insertIngest = {
      ...newIngest,
      _id: _id.toString()
    };
    const response = await this.nanoDb.insert(
      insertIngest as unknown as nano.MaybeDocument
    );
    if (!response.ok) throw new Error('Failed to insert ingest');
    return { ...newIngest, _id } as any;
  }

  /** Get all ingests from the database in reverse natural order, limited by the limit parameter */
  async getIngests(limit: number, offset: number): Promise<Ingest[]> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    const ingests: Ingest[] = [];
    const response = await this.nanoDb.list({
      include_docs: true
    });
    // eslint-disable-next-line
    response.rows.forEach((row: any) => {
      if (
        row.doc._id.toLowerCase().indexOf('counter') === -1 &&
        row.doc._id.toLowerCase().indexOf('session_') === -1
      )
        ingests.push(row.doc);
    });

    // Apply offset and limit
    const result = ingests.slice(offset, offset + limit);
    return result as any as Ingest[];
  }

  async getIngestsLength(): Promise<number> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    const ingests = await this.nanoDb.list({ include_docs: false });
    // Filter out counter and session documents
    const filteredRows = ingests.rows.filter(
      (row: any) =>
        row.id.toLowerCase().indexOf('counter') === -1 &&
        row.id.toLowerCase().indexOf('session_') === -1
    );
    return filteredRows.length;
  }

  async getIngest(id: number): Promise<Ingest | undefined> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    const ingest = await this.nanoDb.get(id.toString());
    // eslint-disable-next-line
    return ingest as any | undefined;
  }

  async updateIngest(ingest: Ingest): Promise<Ingest | undefined> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    const existingIngest = await this.nanoDb.get(ingest._id.toString());
    const updatedIngest = {
      ...existingIngest,
      ...ingest,
      _id: ingest._id.toString()
    };
    const response = await this.nanoDb.insert(updatedIngest);
    return response.ok ? ingest : undefined;
  }

  async deleteIngest(ingestId: number): Promise<boolean> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    const ingest = await this.nanoDb.get(ingestId.toString());
    const response = await this.nanoDb.destroy(ingest._id, ingest._rev);
    return response.ok;
  }

  // Session management methods
  async saveUserSession(
    sessionId: string,
    userSession: UserSession
  ): Promise<void> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    const sessionDocId = `session_${sessionId}`;

    try {
      let existingDoc: any;

      // Check if document exists, if not set id
      try {
        existingDoc = await this.nanoDb.get(sessionDocId);
      } catch (err: any) {
        if (err.statusCode === 404) {
          existingDoc = { _id: sessionDocId };
        } else {
          throw err;
        }
      }
      const updatedSession = {
        ...existingDoc,
        ...userSession,
        _id: sessionDocId
      };

      await this.nanoDb.insert(updatedSession);
    } catch (error) {
      return;
    }
  }

  async deleteUserSession(sessionId: string): Promise<boolean> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }

    const sessionDocId = `session_${sessionId}`;
    try {
      const session = await this.nanoDb.get(sessionDocId);
      const response = await this.nanoDb.destroy(session._id, session._rev);
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  async getSession(sessionId: string): Promise<UserSession | null> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }
    const sessionDocId = `session_${sessionId}`;

    // wrap inside try-block to be consistent with mongodb implementation
    try {
      const session = await this.nanoDb.get(sessionDocId);
      return session as any as UserSession;
    } catch (err: any) {
      if (err.statusCode === 404) {
        return null;
      } else {
        throw err;
      }
    }
  }

  async updateSession(
    sessionId: string,
    updates: Partial<UserSession>
  ): Promise<boolean> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }
    const id = `session_${sessionId}`;
    try {
      const doc = await this.nanoDb.get(id);

      const updateData: any = { ...updates };

      // converts lastSeen to a timestamp
      if ('lastSeen' in updates && typeof updates.lastSeen === 'number') {
        updateData.lastSeenAt = new Date(updates.lastSeen);
      }

      // to ensure lastSeenAt is a Date object
      if ('lastSeenAt' in updates && typeof updates.lastSeenAt !== undefined) {
        const v = updates.lastSeenAt as any;
        updateData.lastSeenAt = v instanceof Date ? v : new Date(v);
      }

      const updated = { ...doc, ...updates };
      await this.nanoDb.insert(updated);
      return true;
    } catch (error) {
      return false;
    }
  }

  async getSessionsByQuery(q: Partial<UserSession>): Promise<UserSession[]> {
    await this.connect();
    if (!this.nanoDb) {
      throw new Error('Database not connected');
    }
    const selector: any = { ...q };
    delete selector.lastSeen;
    const response = await this.nanoDb.find({ selector });
    return response.docs as unknown as UserSession[]; // could also expand type UserSession to avoid unknown
  }

  async upsertRole(role: Role): Promise<Role> {
    const now = this.nowIso();
    const payload = {
      ...role,
      _id: role._id || randomUUID(),
      docType: 'role',
      createdAt: role.createdAt ?? now,
      updatedAt: now
    } as Record<string, unknown>;
    return this.upsertDoc<Role>(payload);
  }

  async getRoleByScope(scope: string): Promise<Role | undefined> {
    const docs = await this.findDocs<Role>({ docType: 'role', scope });
    return docs[0];
  }

  async listRoles(): Promise<Role[]> {
    return this.findDocs<Role>({ docType: 'role' });
  }

  async createOrganization(org: Organization): Promise<Organization> {
    const now = this.nowIso();
    const payload = {
      ...org,
      _id: org._id || randomUUID(),
      slug: this.slugify(org.slug || org.name),
      docType: 'organization',
      createdAt: org.createdAt ?? now,
      updatedAt: now
    } as Record<string, unknown>;
    return this.upsertDoc<Organization>(payload);
  }

  async getOrganization(id: string): Promise<Organization | null> {
    return this.getDoc<Organization>(id);
  }

  async listOrganizations(): Promise<Organization[]> {
    return this.findDocs<Organization>({ docType: 'organization' });
  }

  async upsertUser(user: User): Promise<User> {
    const now = this.nowIso();
    const payload = {
      ...user,
      _id: user._id || randomUUID(),
      devices: user.devices ?? [],
      roleIds: user.roleIds ?? [],
      docType: 'user',
      createdAt: user.createdAt ?? now,
      updatedAt: now
    } as Record<string, unknown>;
    return this.upsertDoc<User>(payload);
  }

  async getUser(id: string): Promise<User | null> {
    return this.getDoc<User>(id);
  }

  async listUsersByOrganization(organizationId: string): Promise<User[]> {
    return this.findDocs<User>({ docType: 'user', organizationId });
  }

  async savePanelLayout(layout: PanelLayout): Promise<PanelLayout> {
    const now = this.nowIso();
    const payload = {
      ...layout,
      _id: layout._id || randomUUID(),
      docType: 'panelLayout',
      version: layout.version ?? 1,
      createdAt: layout.createdAt ?? now,
      updatedAt: now
    } as Record<string, unknown>;
    return this.upsertDoc<PanelLayout>(payload);
  }

  async listPanelLayouts(productionId: number): Promise<PanelLayout[]> {
    return this.findDocs<PanelLayout>({ docType: 'panelLayout', productionId });
  }

  async getPanelLayout(id: string): Promise<PanelLayout | null> {
    return this.getDoc<PanelLayout>(id);
  }

  async deletePanelLayout(id: string): Promise<boolean> {
    return this.deleteDoc(id);
  }

  async saveChannelPreset(preset: ChannelPreset): Promise<ChannelPreset> {
    const now = this.nowIso();
    const payload = {
      ...preset,
      _id: preset._id || randomUUID(),
      docType: 'channelPreset',
      version: preset.version ?? 1,
      createdAt: preset.createdAt ?? now,
      updatedAt: now
    } as Record<string, unknown>;
    return this.upsertDoc<ChannelPreset>(payload);
  }

  async listChannelPresets(productionId: number): Promise<ChannelPreset[]> {
    return this.findDocs<ChannelPreset>({ docType: 'channelPreset', productionId });
  }

  async getChannelPreset(id: string): Promise<ChannelPreset | null> {
    return this.getDoc<ChannelPreset>(id);
  }

  async deleteChannelPreset(id: string): Promise<boolean> {
    return this.deleteDoc(id);
  }

  async saveDevice(device: Device): Promise<Device> {
    const now = this.nowIso();
    const payload = {
      ...device,
      _id: device._id || randomUUID(),
      docType: 'device',
      createdAt: device.createdAt ?? now,
      updatedAt: now
    } as Record<string, unknown>;
    return this.upsertDoc<Device>(payload);
  }

  async getDevice(id: string): Promise<Device | null> {
    return this.getDoc<Device>(id);
  }

  async listDevicesByOrganization(organizationId: string): Promise<Device[]> {
    return this.findDocs<Device>({ docType: 'device', organizationId });
  }

  async saveAutomationHook(hook: AutomationHook): Promise<AutomationHook> {
    const now = this.nowIso();
    const payload = {
      ...hook,
      _id: hook._id || randomUUID(),
      docType: 'automationHook',
      createdAt: hook.createdAt ?? now,
      updatedAt: now
    } as Record<string, unknown>;
    return this.upsertDoc<AutomationHook>(payload);
  }

  async listAutomationHooks(productionId: number): Promise<AutomationHook[]> {
    return this.findDocs<AutomationHook>({
      docType: 'automationHook',
      productionId
    });
  }

  async deleteAutomationHook(id: string): Promise<boolean> {
    return this.deleteDoc(id);
  }
}
