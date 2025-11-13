import api from './api';
import { CoreFunctions } from './api_productions_core_functions';
import { ConnectionQueue } from './connection_queue';

jest.mock('./db/interface', () => ({
  getIngests: jest.fn().mockResolvedValue([]),
  connect: jest.fn()
}));

jest.mock('./ingest_manager', () => {
  return {
    IngestManager: jest.fn().mockImplementation(() => ({
      load: jest.fn().mockResolvedValue(undefined),
      startPolling: jest.fn()
    }))
  };
});

jest.mock('./db/mongodb');

const mockDbManager = {
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  getProduction: jest.fn().mockResolvedValue(undefined),
  getProductions: jest.fn().mockResolvedValue([]),
  getProductionsLength: jest.fn().mockResolvedValue(0),
  updateProduction: jest.fn().mockResolvedValue(undefined),
  addProduction: jest.fn().mockResolvedValue({}),
  deleteProduction: jest.fn().mockResolvedValue(true),
  setLineConferenceId: jest.fn().mockResolvedValue(undefined),
  addIngest: jest.fn().mockResolvedValue({}),
  getIngest: jest.fn().mockResolvedValue(undefined),
  getIngestsLength: jest.fn().mockResolvedValue(0),
  getIngests: jest.fn().mockResolvedValue([]),
  updateIngest: jest.fn().mockResolvedValue(undefined),
  deleteIngest: jest.fn().mockResolvedValue(true),
  saveUserSession: jest.fn().mockResolvedValue(undefined),
  getSession: jest.fn().mockResolvedValue(null),
  deleteUserSession: jest.fn().mockResolvedValue(true),
  updateSession: jest.fn().mockResolvedValue(true),
  getSessionsByQuery: jest.fn().mockResolvedValue([]),
  upsertRole: jest.fn().mockResolvedValue({}),
  getRoleByScope: jest.fn().mockResolvedValue(undefined),
  listRoles: jest.fn().mockResolvedValue([]),
  createOrganization: jest.fn().mockResolvedValue({}),
  getOrganization: jest.fn().mockResolvedValue(null),
  listOrganizations: jest.fn().mockResolvedValue([]),
  upsertUser: jest.fn().mockResolvedValue({}),
  getUser: jest.fn().mockResolvedValue(null),
  listUsersByOrganization: jest.fn().mockResolvedValue([]),
  savePanelLayout: jest.fn().mockResolvedValue({}),
  listPanelLayouts: jest.fn().mockResolvedValue([]),
  getPanelLayout: jest.fn().mockResolvedValue(null),
  deletePanelLayout: jest.fn().mockResolvedValue(true),
  saveChannelPreset: jest.fn().mockResolvedValue({}),
  listChannelPresets: jest.fn().mockResolvedValue([]),
  getChannelPreset: jest.fn().mockResolvedValue(null),
  deleteChannelPreset: jest.fn().mockResolvedValue(true),
  saveDevice: jest.fn().mockResolvedValue({}),
  getDevice: jest.fn().mockResolvedValue(null),
  listDevicesByOrganization: jest.fn().mockResolvedValue([]),
  saveAutomationHook: jest.fn().mockResolvedValue({}),
  listAutomationHooks: jest.fn().mockResolvedValue([]),
  deleteAutomationHook: jest.fn().mockResolvedValue(true)
};

const mockProductionManager = {
  checkUserStatus: jest.fn(),
  load: jest.fn().mockResolvedValue(undefined),
  createProduction: jest.fn().mockResolvedValue({}),
  getProductions: jest.fn().mockResolvedValue([]),
  getNumberOfProductions: jest.fn().mockResolvedValue(0),
  requireProduction: jest.fn().mockResolvedValue({}),
  updateProduction: jest.fn().mockResolvedValue({}),
  addProductionLine: jest.fn().mockResolvedValue(undefined),
  getLine: jest.fn().mockResolvedValue(undefined),
  getUsersForLine: jest.fn().mockResolvedValue([]),
  updateProductionLine: jest.fn().mockResolvedValue({}),
  deleteProductionLine: jest.fn().mockResolvedValue(undefined),
  deleteProduction: jest.fn().mockResolvedValue(true),
  removeUserSession: jest.fn().mockResolvedValue('session-id'),
  getUser: jest.fn().mockResolvedValue(undefined),
  requireLine: jest.fn().mockResolvedValue({}),
  updateUserLastSeen: jest.fn().mockResolvedValue(true),
  getProduction: jest.fn().mockResolvedValue(undefined),
  setLineId: jest.fn().mockResolvedValue(undefined),
  createUserSession: jest.fn(),
  updateUserEndpoint: jest.fn().mockResolvedValue(true),
  on: jest.fn(),
  once: jest.fn(),
  emit: jest.fn()
} as any;

const mockIngestManager = {
  load: jest.fn().mockResolvedValue(undefined),
  startPolling: jest.fn()
} as any;

describe('api', () => {
  it('responds with hello, world!', async () => {
    const server = await api({
      title: 'my awesome service',
      smbServerBaseUrl: 'http://localhost',
      endpointIdleTimeout: '60',
      publicHost: 'http://localhost',
      dbManager: mockDbManager,
      productionManager: mockProductionManager,
      ingestManager: mockIngestManager,
      coreFunctions: new CoreFunctions(
        mockProductionManager,
        new ConnectionQueue()
      ),
      auth: { allowAnonymous: true, defaultScopes: ['admin'] }
    });
    const response = await server.inject({
      method: 'GET',
      url: '/'
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('Hello, world! I am my awesome service');
  });
});
