import { z } from "zod";

const flag = z
  .enum(["0", "1", "true", "false"])
  .default("0")
  .transform((v) => v === "1" || v === "true");

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const DEV_SESSION_SECRET = "dev-only-session-secret-change-me-0000000000";

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

    // Live PayPal money movement is a non-goal (PRD section 4). Only sandbox is accepted.
    PAYPAL_ENV: z.literal("sandbox", { error: "PAYPAL_ENV must be 'sandbox'" }),
    PAYPAL_CLIENT_ID: z.string().min(1, "PAYPAL_CLIENT_ID is required"),
    PAYPAL_CLIENT_SECRET: z.string().min(1, "PAYPAL_CLIENT_SECRET is required"),
    PAYPAL_WEBHOOK_ID: optionalString,
    PAYPAL_PLATFORM_EMAIL: optionalString,
    AUTH_SAFE_WINDOW_HOURS: z.coerce.number().int().min(1).max(720).default(72),

    APP_URL: z.url().default("http://localhost:3000"),
    API_URL: z.url().default("http://localhost:4000"),
    SESSION_SECRET: optionalString,
    PAYLOCK_FREEZE: flag,
    // stub: deterministic placeholder agents (Phase 2); live: LLM agents; replay: recorded fixtures.
    AGENTS_MODE: z.enum(["stub", "live", "replay"]).default("stub"),
    // Test-only server-side card funding route (BUILD_PLAN 2.4). Never set on Render.
    E2E_FUNDING: z.enum(["off", "card"]).default("off"),
    FUNDING_TIMEOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
    SWEEPER_INTERVAL_MS: z.coerce.number().int().min(0).max(600_000).default(5000),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32)) {
      ctx.addIssue({
        code: "custom",
        path: ["SESSION_SECRET"],
        message: "SESSION_SECRET must be at least 32 characters in production",
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export interface Config {
  nodeEnv: Env["NODE_ENV"];
  port: number;
  logLevel: Env["LOG_LEVEL"];
  databaseUrl: string;
  paypal: {
    env: "sandbox";
    baseUrl: string;
    clientId: string;
    clientSecret: string;
    webhookId?: string;
    platformEmail?: string;
  };
  authSafeWindowHours: number;
  appUrl: string;
  apiUrl: string;
  sessionSecret: string;
  freeze: boolean;
  agentsMode: Env["AGENTS_MODE"];
  /** True only when the E2E card route may be registered (sandbox, not production). */
  e2eCardFunding: boolean;
  fundingTimeoutMinutes: number;
  /** 0 disables the background sweeper (tests). */
  sweeperIntervalMs: number;
}

export const PAYPAL_BASE_URLS = {
  sandbox: "https://api-m.sandbox.paypal.com",
} as const;

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment:\n  - ${issues.join("\n  - ")}`);
    this.name = "ConfigError";
  }
}

/** Validate process env. Error messages name variables, never their values. */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  const e = parsed.data;
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    paypal: {
      env: e.PAYPAL_ENV,
      baseUrl: PAYPAL_BASE_URLS[e.PAYPAL_ENV],
      clientId: e.PAYPAL_CLIENT_ID,
      clientSecret: e.PAYPAL_CLIENT_SECRET,
      webhookId: e.PAYPAL_WEBHOOK_ID,
      platformEmail: e.PAYPAL_PLATFORM_EMAIL,
    },
    authSafeWindowHours: e.AUTH_SAFE_WINDOW_HOURS,
    appUrl: e.APP_URL,
    apiUrl: e.API_URL,
    sessionSecret: e.SESSION_SECRET ?? DEV_SESSION_SECRET,
    freeze: e.PAYLOCK_FREEZE,
    agentsMode: e.AGENTS_MODE,
    e2eCardFunding:
      e.E2E_FUNDING === "card" && e.PAYPAL_ENV === "sandbox" && e.NODE_ENV !== "production",
    fundingTimeoutMinutes: e.FUNDING_TIMEOUT_MINUTES,
    sweeperIntervalMs: e.SWEEPER_INTERVAL_MS,
  };
}
