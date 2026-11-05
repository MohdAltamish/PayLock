import { loadConfig } from "../../apps/api/src/config/env.js";
import { PayPalHttp } from "../../apps/api/src/paypal/http.js";
import { TokenProvider } from "../../apps/api/src/paypal/token.js";

/** PayPal client for CLI scripts. Loads config from the env (run with --env-file=.env). */
export function scriptClient() {
  const config = loadConfig();
  const tokens = new TokenProvider({
    baseUrl: config.paypal.baseUrl,
    clientId: config.paypal.clientId,
    clientSecret: config.paypal.clientSecret,
  });
  const log = {
    info: (o: object, m: string) => console.log(`  ${m}`, compact(o)),
    warn: (o: object, m: string) => console.warn(`  WARN ${m}`, compact(o)),
    error: (o: object, m: string) => console.error(`  ERROR ${m}`, compact(o)),
    debug: () => {},
  };
  const http = new PayPalHttp({ baseUrl: config.paypal.baseUrl, tokens, log });
  return { config, tokens, http };
}

function compact(o: object): string {
  return JSON.stringify(o, (_k, v) => (v === undefined ? undefined : v));
}
