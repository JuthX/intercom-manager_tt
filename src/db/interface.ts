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

export interface DbManager {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getProduction(id: number): Promise<Production | undefined>;
  getProductions(limit: number, offset: number): Promise<Production[]>;
  getProductionsLength(): Promise<number>;
  updateProduction(production: Production): Promise<Production | undefined>;
  addProduction(name: string, lines: Line[]): Promise<Production>;
  deleteProduction(productionId: number): Promise<boolean>;
  setLineConferenceId(
    productionId: number,
    lineId: string,
    conferenceId: string
  ): Promise<void>;
  addIngest(newIngest: NewIngest): Promise<Ingest>;
  getIngest(id: number): Promise<Ingest | undefined>;
  getIngestsLength(): Promise<number>;
  getIngests(limit: number, offset: number): Promise<Ingest[]>;
  updateIngest(ingest: Ingest): Promise<Ingest | undefined>;
  deleteIngest(ingestId: number): Promise<boolean>;
  saveUserSession(sessionId: string, userSession: UserSession): Promise<void>;
  getSession(sessionId: string): Promise<UserSession | null>;
  deleteUserSession(sessionId: string): Promise<boolean>;
  updateSession(
    sessionId: string,
    updates: Partial<UserSession>
  ): Promise<boolean>;
  getSessionsByQuery(q: Partial<UserSession>): Promise<UserSession[]>;
  upsertRole(role: Role): Promise<Role>;
  getRoleByScope(scope: string): Promise<Role | undefined>;
  listRoles(): Promise<Role[]>;
  createOrganization(org: Organization): Promise<Organization>;
  getOrganization(id: string): Promise<Organization | null>;
  listOrganizations(): Promise<Organization[]>;
  upsertUser(user: User): Promise<User>;
  getUser(id: string): Promise<User | null>;
  listUsersByOrganization(organizationId: string): Promise<User[]>;
  savePanelLayout(layout: PanelLayout): Promise<PanelLayout>;
  listPanelLayouts(productionId: number): Promise<PanelLayout[]>;
  getPanelLayout(id: string): Promise<PanelLayout | null>;
  deletePanelLayout(id: string): Promise<boolean>;
  saveChannelPreset(preset: ChannelPreset): Promise<ChannelPreset>;
  listChannelPresets(productionId: number): Promise<ChannelPreset[]>;
  getChannelPreset(id: string): Promise<ChannelPreset | null>;
  deleteChannelPreset(id: string): Promise<boolean>;
  saveDevice(device: Device): Promise<Device>;
  getDevice(id: string): Promise<Device | null>;
  listDevicesByOrganization(organizationId: string): Promise<Device[]>;
  saveAutomationHook(hook: AutomationHook): Promise<AutomationHook>;
  listAutomationHooks(productionId: number): Promise<AutomationHook[]>;
  deleteAutomationHook(id: string): Promise<boolean>;
}
