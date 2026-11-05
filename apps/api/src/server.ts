import { buildApp } from "./app.js";
import { ConfigError, loadConfig } from "./config/env.js";
import { closeDb, getDb, pingDb } from "./lib/db.js";
import { PayPalHttp } from "./paypal/http.js";
import { TokenProvider } from "./paypal/token.js";
import { WebhookProcessor } from "./webhooks/processor.js";
import { PrismaWebhookStore } from "./webhooks/store.js";
import { PayPalWebhookVerifier } from "./webhooks/verify.js";

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const db = getDb(config.databaseUrl);
  const tokens = new TokenProvider({
    baseUrl: config.paypal.baseUrl,
    clientId: config.paypal.clientId,
    clientSecret: config.paypal.clientSecret,
  });

  // PayPal client and webhook processor log through the app logger once it exists.
  const store = new PrismaWebhookStore(db);
  const lazyLog = {
    info: (o: object, m: string) => app.log.info(o, m),
    warn: (o: object, m: string) => app.log.warn(o, m),
    error: (o: object, m: string) => app.log.error(o, m),
    debug: (o: object, m: string) => app.log.debug(o, m),
  };
  const http = new PayPalHttp({ baseUrl: config.paypal.baseUrl, tokens, log: lazyLog });

  const app = await buildApp({
    config,
    deps: {
      healthChecks: {
        db: () => pingDb(db),
        // Served from cache after the first call; only re-fetches near expiry.
        paypal: async () => {
          await tokens.getToken();
        },
      },
      webhooks: {
        verifier: config.paypal.webhookId
          ? new PayPalWebhookVerifier(http, config.paypal.webhookId)
          : undefined,
        store,
        processor: new WebhookProcessor(store, lazyLog),
      },
    },
  });
  if (!config.paypal.webhookId)
    app.log.warn("PAYPAL_WEBHOOK_ID is not set; /webhooks/paypal will return 503");

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ host: "0.0.0.0", port: config.port });
}

void main();
