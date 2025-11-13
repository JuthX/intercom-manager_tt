import api from './api';
import { CoreFunctions } from './api_productions_core_functions';
import { ConnectionQueue } from './connection_queue';
import { DbManagerCouchDb } from './db/couchdb';
import { DbManagerMongoDb } from './db/mongodb';
import { IngestManager } from './ingest_manager';
import { MediaBridgePool } from './media_bridge_pool';
import MetricsPlugin from './metrics';
import { QoSTelemetryCollector } from './metrics/qos';
import { Log } from './log';
import { ProductionManager } from './production_manager';
import SipGatewayApi from './sip_gateway/api';
import { SipGateway, SipGatewayOptions } from './sip_gateway';

const SMB_ADDRESS: string = process.env.SMB_ADDRESS ?? 'http://localhost:8080';
const PUBLIC_HOST: string = process.env.PUBLIC_HOST ?? 'http://localhost:8000';

if (!process.env.SMB_ADDRESS) {
  console.warn('SMB_ADDRESS environment variable not set, using defaults');
}

const ENDPOINT_IDLE_TIMEOUT_S: string =
  process.env.ENDPOINT_IDLE_TIMEOUT_S ?? '60';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8000;
const MEDIA_BRIDGES_ENV = process.env.MEDIA_BRIDGES;
const mediaBridgePool = MediaBridgePool.fromEnv({
  defaultBaseUrl: SMB_ADDRESS,
  defaultApiKey: process.env.SMB_APIKEY,
  envJson: MEDIA_BRIDGES_ENV,
  probeIntervalMs: process.env.MEDIA_BRIDGE_PROBE_INTERVAL_MS
    ? Number(process.env.MEDIA_BRIDGE_PROBE_INTERVAL_MS)
    : undefined
});

const telemetryCollector = new QoSTelemetryCollector();

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
  const productionManager = new ProductionManager(dbManager);
  await productionManager.load();

  const connectionQueue = new ConnectionQueue();
  const ingestManager = new IngestManager(dbManager);
  await ingestManager.load();

  let sipGateway: SipGateway | undefined;
  if (process.env.SIP_GATEWAY_URL && process.env.SIP_GATEWAY_PROVIDER) {
    const gatewayOptions: SipGatewayOptions = {
      provider: process.env.SIP_GATEWAY_PROVIDER as 'freeswitch' | 'asterisk',
      baseUrl: process.env.SIP_GATEWAY_URL,
      username: process.env.SIP_GATEWAY_USERNAME,
      password: process.env.SIP_GATEWAY_PASSWORD,
      defaultCallerId: process.env.SIP_GATEWAY_CALLER_ID
    };
    sipGateway = new SipGateway(gatewayOptions);
  }

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
    mediaBridgePool,
    telemetryCollector,
    sipGateway,
    coreFunctions: new CoreFunctions(productionManager, connectionQueue)
  });

  server.register(MetricsPlugin, {
    mediaBridgePool,
    telemetryCollector
  });

  if (sipGateway) {
    server.register(SipGatewayApi, { sipGateway });
  }

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
