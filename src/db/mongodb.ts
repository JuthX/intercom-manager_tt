import '../config/load-env';
import { randomUUID } from 'crypto';
import { MongoClient } from 'mongodb';
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
import { Log } from '../log';

const SESSION_PRUNE_SECONDS = 7_200;

export class DbManagerMongoDb implements DbManager {
  private client: MongoClient;
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

  private withTimestamps<T extends { createdAt: string; updatedAt: string }>(
    doc: Partial<T>
  ): { createdAt: string; updatedAt: string } {
    const now = this.nowIso();
    return {
      createdAt: (doc.createdAt as string) ?? now,
      updatedAt: now
    };
  }

  constructor(dbConnectionUrl: URL) {
    this.client = new MongoClient(dbConnectionUrl.toString());
  }

  async connect(): Promise<void> {
    await this.client.connect();
    const db = this.client.db();
    const sessions = db.collection('sessions');

    // Ensure a expire-after-index on lastSeenAt so old sessions are automatically removed by MongoDB after SESSION_PRUNE_SECONDS
    const expireIndexName = 'lastSeenAt_1';
    let expireIndexExists = false;
    try {
      expireIndexExists = await sessions.indexExists(expireIndexName);
    } catch (error: any) {
      const code = error?.code;
      const message = error?.message.toString() || '';
      const namespaceMissing =
        code === 26 ||
        /NamespaceNotFound/i.test(message) ||
        /ns does not exist/i.test(message);
      if (!namespaceMissing) {
        throw error;
      }
    }
    if (!expireIndexExists) {
      await sessions.createIndex(
        { lastSeenAt: 1 },
        { expireAfterSeconds: SESSION_PRUNE_SECONDS }
      );
    } else {
      // Update expireAfterSeconds on existing index if it already exists
      try {
        await db.command({
          collMod: sessions.collectionName,
          index: {
            name: expireIndexName,
            expireAfterSeconds: SESSION_PRUNE_SECONDS
          }
        });
      } catch (e) {
        Log().error(e);
      }
    }

    // Helper to create indexes safely (ignore "already exists" errors)
    const safeCreate = async (keys: Record<string, 1 | -1>, opts: any = {}) => {
      try {
        await sessions.createIndex(keys, opts);
      } catch (err: any) {
        const msg = String(err?.message || '');
        if (!/already exists/i.test(msg)) throw err;
      }
    };

    await safeCreate({
      productionId: 1,
      lineId: 1,
      isExpired: 1,
      lastSeenAt: -1
    });

    await safeCreate({ isExpired: 1, isActive: 1, lastSeenAt: 1 });
    await safeCreate({ productionId: 1 });
    await safeCreate({ endpointId: 1 });
    await safeCreate({ productionId: 1, endpointId: 1 });

    const ensureCollectionIndex = async (
      collectionName: string,
      keys: Record<string, 1 | -1>,
      opts: any = {}
    ) => {
      const collection = db.collection(collectionName);
      try {
        await collection.createIndex(keys, opts);
      } catch (err: any) {
        const msg = String(err?.message || '');
        if (!/already exists/i.test(msg)) throw err;
      }
    };

    await ensureCollectionIndex('organizations', { slug: 1 }, { unique: true });
    await ensureCollectionIndex('roles', { scope: 1 }, { unique: true });
    await ensureCollectionIndex('users', { organizationId: 1, email: 1 }, { unique: true });
    await ensureCollectionIndex('panelLayouts', { productionId: 1, version: -1 });
    await ensureCollectionIndex('panelLayouts', { organizationId: 1 });
    await ensureCollectionIndex('channelPresets', { productionId: 1, version: -1 });
    await ensureCollectionIndex('devices', { organizationId: 1 });
    await ensureCollectionIndex('devices', { userId: 1 });
    await ensureCollectionIndex('automationHooks', { productionId: 1, event: 1 });
  }

  async disconnect(): Promise<void> {
    await this.client.close();
  }

  private async getNextSequence(collectionName: string): Promise<number> {
    const db = this.client.db();
    const ret = await db.command({
      findAndModify: 'counters',
      query: { _id: collectionName },
      update: { $inc: { seq: 1 } },
      new: true,
      upsert: true
    });
    return ret.value?.seq || 1;
  }

  /** Get all productions from the database in reverse natural order, limited by the limit parameter */
  async getProductions(limit: number, offset: number): Promise<Production[]> {
    const db = this.client.db();
    const productions = await db
      .collection('productions')
      .find()
      .sort({ $natural: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    return productions as unknown as Production[];
  }

  async getProductionsLength(): Promise<number> {
    const db = this.client.db();
    return await db.collection('productions').countDocuments();
  }

  async getProduction(id: number): Promise<Production | undefined> {
    const db = this.client.db();
    // eslint-disable-next-line
    return db.collection('productions').findOne({ _id: id as any }) as
      | any
      | undefined;
  }

  async updateProduction(
    production: Production
  ): Promise<Production | undefined> {
    const db = this.client.db();
    const result = await db
      .collection('productions')
      .updateOne({ _id: production._id as any }, { $set: production });
    return result.modifiedCount === 1 ? production : undefined;
  }

  async addProduction(name: string, lines: Line[]): Promise<Production> {
    const db = this.client.db();
    const _id = await this.getNextSequence('productions');
    const production = { name, lines, _id };
    await db.collection('productions').insertOne(production as any);
    return production;
  }

  async deleteProduction(productionId: number): Promise<boolean> {
    const db = this.client.db();
    const result = await db
      .collection('productions')
      .deleteOne({ _id: productionId as any });
    return result.deletedCount === 1;
  }

  async setLineConferenceId(
    productionId: number,
    lineId: string,
    conferenceId: string
  ): Promise<void> {
    const production = await this.getProduction(productionId);
    assert(production, `Production with id "${productionId}" does not exist`);
    const line = production.lines.find((line) => line.id === lineId);
    assert(
      line,
      `Line with id "${lineId}" does not exist for production with id "${productionId}"`
    );
    line.smbConferenceId = conferenceId;
    const db = this.client.db();
    await db
      .collection('productions')
      .updateOne(
        { _id: productionId as any },
        { $set: { lines: production.lines } }
      );
  }

  async addIngest(newIngest: NewIngest): Promise<Ingest> {
    const db = this.client.db();
    const _id = await this.getNextSequence('ingests');
    const ingest = { ...newIngest, _id };
    await db.collection<Ingest>('ingests').insertOne(ingest as any);
    return ingest as Ingest;
  }

  /** Get all ingests from the database in reverse natural order, limited by the limit parameter */
  async getIngests(limit: number, offset: number): Promise<Ingest[]> {
    const db = this.client.db();
    const ingests = await db
      .collection<Ingest>('ingests')
      .find()
      .sort({ $natural: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    return ingests as Ingest[];
  }

  async getIngest(id: number): Promise<Ingest | undefined> {
    const db = this.client.db();
    // eslint-disable-next-line
    return db.collection<Ingest>('ingests').findOne({ _id: id as any }) as
      | any
      | undefined;
  }

  async getIngestsLength(): Promise<number> {
    const db = this.client.db();
    return await db.collection<Ingest>('ingests').countDocuments();
  }

  async updateIngest(ingest: Ingest): Promise<Ingest | undefined> {
    const db = this.client.db();
    const result = await db
      .collection<Ingest>('ingests')
      .updateOne({ _id: ingest._id as any }, { $set: ingest });
    return result.modifiedCount === 1 ? ingest : undefined;
  }

  async deleteIngest(ingestId: number): Promise<boolean> {
    const db = this.client.db();
    const result = await db
      .collection<Ingest>('ingests')
      .deleteOne({ _id: ingestId as any });
    return result.deletedCount === 1;
  }

  async saveUserSession(
    sessionId: string,
    userSession: Omit<UserSession, '_id' | 'createdAt' | 'lastSeenAt'>
  ): Promise<void> {
    const db = this.client.db();
    const sessions = db.collection('sessions');
    const now = new Date();
    await sessions.updateOne(
      { _id: sessionId as any },
      {
        $setOnInsert: { createdAt: now },
        $set: {
          ...userSession,
          lastSeenAt: new Date(userSession.lastSeen ?? Date.now())
        }
      },
      { upsert: true }
    );
  }

  // Retreive session from db based on sessionId
  async getSession(sessionId: string): Promise<UserSession | null> {
    const db = this.client.db();
    return db.collection('sessions').findOne({ _id: sessionId as any }) as any;
  }

  // Delete session in db
  async deleteUserSession(sessionId: string): Promise<boolean> {
    const db = this.client.db();
    const result = await db
      .collection('sessions')
      .deleteOne({ _id: sessionId as any });
    return result.deletedCount === 1;
  }

  // Update db session
  async updateSession(
    sessionId: string,
    updates: Partial<UserSession>
  ): Promise<boolean> {
    const db = this.client.db();
    const $set: Record<string, unknown> = { ...updates };

    if ('lastSeen' in updates && typeof updates.lastSeen === 'number') {
      $set.lastSeenAt = new Date(updates.lastSeen);
    }

    if ('lastSeenAt' in updates && updates.lastSeenAt !== undefined) {
      const v = updates.lastSeenAt as any;
      $set.lastSeenAt = v instanceof Date ? v : new Date(v);
    }

    const res = await db
      .collection('sessions')
      .updateOne({ _id: sessionId } as any, { $set });

    return res.matchedCount === 1;
  }

  // Get database sessions matching query
  async getSessionsByQuery(q: Partial<UserSession>): Promise<UserSession[]> {
    const db = this.client.db();
    const sessions = db.collection<UserSession>('sessions');
    const mongoQuery: Record<string, unknown> = { ...q };

    delete (mongoQuery as any).lastSeen;

    return sessions.find(mongoQuery).toArray();
  }

  async upsertRole(role: Role): Promise<Role> {
    const db = this.client.db();
    const collection = db.collection<Role>('roles');
    const timestamps = this.withTimestamps<Role>(role);
    const doc: Role = {
      ...role,
      _id: role._id || randomUUID(),
      ...timestamps
    } as Role;
    await collection.updateOne({ _id: doc._id }, { $set: doc }, { upsert: true });
    return doc;
  }

  async getRoleByScope(scope: string): Promise<Role | undefined> {
    const db = this.client.db();
    const result = await db.collection<Role>('roles').findOne({ scope });
    return result ?? undefined;
  }

  async listRoles(): Promise<Role[]> {
    const db = this.client.db();
    return db.collection<Role>('roles').find().sort({ name: 1 }).toArray();
  }

  async createOrganization(org: Organization): Promise<Organization> {
    const db = this.client.db();
    const collection = db.collection<Organization>('organizations');
    const timestamps = this.withTimestamps<Organization>(org);
    const slug = this.slugify(org.slug || org.name);
    const doc: Organization = {
      ...org,
      _id: org._id || randomUUID(),
      slug,
      ...timestamps
    } as Organization;
    await collection.updateOne({ _id: doc._id }, { $set: doc }, { upsert: true });
    return doc;
  }

  async getOrganization(id: string): Promise<Organization | null> {
    const db = this.client.db();
    return db.collection<Organization>('organizations').findOne({ _id: id });
  }

  async listOrganizations(): Promise<Organization[]> {
    const db = this.client.db();
    return db
      .collection<Organization>('organizations')
      .find()
      .sort({ name: 1 })
      .toArray();
  }

  async upsertUser(user: User): Promise<User> {
    const db = this.client.db();
    const collection = db.collection<User>('users');
    const timestamps = this.withTimestamps<User>(user);
    const doc: User = {
      ...user,
      _id: user._id || randomUUID(),
      devices: user.devices ?? [],
      roleIds: user.roleIds ?? [],
      ...timestamps
    } as User;
    await collection.updateOne({ _id: doc._id }, { $set: doc }, { upsert: true });
    return doc;
  }

  async getUser(id: string): Promise<User | null> {
    const db = this.client.db();
    return db.collection<User>('users').findOne({ _id: id });
  }

  async listUsersByOrganization(organizationId: string): Promise<User[]> {
    const db = this.client.db();
    return db
      .collection<User>('users')
      .find({ organizationId })
      .sort({ displayName: 1 })
      .toArray();
  }

  async savePanelLayout(layout: PanelLayout): Promise<PanelLayout> {
    const db = this.client.db();
    const collection = db.collection<PanelLayout>('panelLayouts');
    const timestamps = this.withTimestamps<PanelLayout>(layout);
    const doc: PanelLayout = {
      ...layout,
      _id: layout._id || randomUUID(),
      version: layout.version ?? 1,
      panels: layout.panels ?? [],
      ...timestamps
    } as PanelLayout;
    await collection.updateOne({ _id: doc._id }, { $set: doc }, { upsert: true });
    return doc;
  }

  async listPanelLayouts(productionId: number): Promise<PanelLayout[]> {
    const db = this.client.db();
    return db
      .collection<PanelLayout>('panelLayouts')
      .find({ productionId })
      .sort({ version: -1 })
      .toArray();
  }

  async getPanelLayout(id: string): Promise<PanelLayout | null> {
    const db = this.client.db();
    return db.collection<PanelLayout>('panelLayouts').findOne({ _id: id });
  }

  async deletePanelLayout(id: string): Promise<boolean> {
    const db = this.client.db();
    const result = await db.collection('panelLayouts').deleteOne({ _id: id });
    return result.deletedCount === 1;
  }

  async saveChannelPreset(preset: ChannelPreset): Promise<ChannelPreset> {
    const db = this.client.db();
    const collection = db.collection<ChannelPreset>('channelPresets');
    const timestamps = this.withTimestamps<ChannelPreset>(preset);
    const doc: ChannelPreset = {
      ...preset,
      _id: preset._id || randomUUID(),
      version: preset.version ?? 1,
      nodes: preset.nodes ?? [],
      edges: preset.edges ?? [],
      priorityRules: preset.priorityRules ?? [],
      ...timestamps
    } as ChannelPreset;
    await collection.updateOne({ _id: doc._id }, { $set: doc }, { upsert: true });
    return doc;
  }

  async listChannelPresets(productionId: number): Promise<ChannelPreset[]> {
    const db = this.client.db();
    return db
      .collection<ChannelPreset>('channelPresets')
      .find({ productionId })
      .sort({ version: -1 })
      .toArray();
  }

  async getChannelPreset(id: string): Promise<ChannelPreset | null> {
    const db = this.client.db();
    return db.collection<ChannelPreset>('channelPresets').findOne({ _id: id });
  }

  async deleteChannelPreset(id: string): Promise<boolean> {
    const db = this.client.db();
    const result = await db.collection('channelPresets').deleteOne({ _id: id });
    return result.deletedCount === 1;
  }

  async saveDevice(device: Device): Promise<Device> {
    const db = this.client.db();
    const collection = db.collection<Device>('devices');
    const timestamps = this.withTimestamps<Device>(device);
    const doc: Device = {
      ...device,
      _id: device._id || randomUUID(),
      ...timestamps
    } as Device;
    await collection.updateOne({ _id: doc._id }, { $set: doc }, { upsert: true });
    return doc;
  }

  async getDevice(id: string): Promise<Device | null> {
    const db = this.client.db();
    return db.collection<Device>('devices').findOne({ _id: id });
  }

  async listDevicesByOrganization(organizationId: string): Promise<Device[]> {
    const db = this.client.db();
    return db
      .collection<Device>('devices')
      .find({ organizationId })
      .sort({ label: 1 })
      .toArray();
  }

  async saveAutomationHook(hook: AutomationHook): Promise<AutomationHook> {
    const db = this.client.db();
    const collection = db.collection<AutomationHook>('automationHooks');
    const timestamps = this.withTimestamps<AutomationHook>(hook);
    const doc: AutomationHook = {
      ...hook,
      _id: hook._id || randomUUID(),
      ...timestamps
    } as AutomationHook;
    await collection.updateOne({ _id: doc._id }, { $set: doc }, { upsert: true });
    return doc;
  }

  async listAutomationHooks(productionId: number): Promise<AutomationHook[]> {
    const db = this.client.db();
    return db
      .collection<AutomationHook>('automationHooks')
      .find({ productionId })
      .toArray();
  }

  async deleteAutomationHook(id: string): Promise<boolean> {
    const db = this.client.db();
    const result = await db.collection('automationHooks').deleteOne({ _id: id });
    return result.deletedCount === 1;
  }
}
