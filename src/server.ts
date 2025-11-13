import api from './api';
import { CoreFunctions } from './api_productions_core_functions';
import { ConnectionQueue } from './connection_queue';
import { AuthModuleOptions } from './auth';
import { DbManagerCouchDb } from './db/couchdb';
import { DbManagerMongoDb } from './db/mongodb';
import { seedReferenceData } from './db/seed';
import { IngestManager } from './ingest_manager';
import { Log } from './log';
import { ProductionManager } from './production_manager';

const SMB_ADDRESS: string = process.env.SMB_ADDRESS ?? 'http://localhost:8080';
const PUBLIC_HOST: string = process.env.PUBLIC_HOST ?? 'http://localhost:8000';

if (!process.env.SMB_ADDRESS) {
  console.warn('SMB_ADDRESS environment variable not set, using defaults');
}

const ENDPOINT_IDLE_TIMEOUT_S: string =
  process.env.ENDPOINT_IDLE_TIMEOUT_S ?? '60';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8000;

const DB_CONNECTION_STRING: string =
  process.env.DB_CONNECTION_STRING ??
  process.env.MONGODB_CONNECTION_STRING ??
  'mongodb://localhost:27017/intercom-manager';
let dbManager;
const dbUrl = new URL(DB_CONNECTION_STRING);
if (dbUrl.protocol === 'mongodb:' || dbUrl.protocol === 'mongodb+srv:') {
  dbManager = new DbManagerMongoDb(dbUrl);
} else if (dbUrl.protocol === 'http:' || dbUrl.protocol === 'https:') {
  dbManager = new DbManagerCouchDb(dbUrl);
} else {
  throw new Error('Unsupported database protocol');
}

(async function startServer() {
  await dbManager.connect();
  await seedReferenceData(dbManager);
  const productionManager = new ProductionManager(dbManager);
  await productionManager.load();

  const connectionQueue = new ConnectionQueue();
  const ingestManager = new IngestManager(dbManager);
  await ingestManager.load();

  const authOptions: AuthModuleOptions = {
    allowAnonymous: process.env.AUTH_ALLOW_ANONYMOUS === 'true',
    oidc: process.env.OIDC_ISSUER
      ? {
          issuer: process.env.OIDC_ISSUER,
          clientId: process.env.OIDC_CLIENT_ID ?? 'intercom'
        }
      : undefined,
    saml: process.env.SAML_ENTITY_ID
      ? { entityId: process.env.SAML_ENTITY_ID, audience: process.env.SAML_AUDIENCE }
      : undefined,
    defaultScopes: ['operator']
  };

  const server = await api({
    title: 'intercom-manager',
    smbServerBaseUrl: SMB_ADDRESS,
    endpointIdleTimeout: ENDPOINT_IDLE_TIMEOUT_S,
    smbServerApiKey: process.env.SMB_APIKEY,
    publicHost: PUBLIC_HOST,
    whipAuthKey: process.env.WHIP_AUTH_KEY,
    dbManager: dbManager,
    productionManager: productionManager,
    ingestManager: ingestManager,
    coreFunctions: new CoreFunctions(productionManager, connectionQueue),
    auth: authOptions
  });

  server.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
    if (err) {
      throw err;
    }
    Log().info(`Manager listening on ${address}`);
    Log().info(
      `Media Bridge at ${SMB_ADDRESS} (${ENDPOINT_IDLE_TIMEOUT_S}s idle timeout)`
    );
  });
})();
