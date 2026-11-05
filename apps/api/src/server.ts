import { buildApp } from "./app.js";
import { ConfigError, loadConfig } from "./config/env.js";
import { closeDb, getDb, pingDb } from "./lib/db.js";

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
  const app = await buildApp({
    config,
    deps: {
      healthChecks: {
        db: () => pingDb(db),
      },
    },
  });

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
