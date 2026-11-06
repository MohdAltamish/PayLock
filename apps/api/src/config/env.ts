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
    // --- LLM (Phase 3). openai = any OpenAI-compatible endpoint at LLM_BASE_URL. ---
    LLM_PROVIDER: z.enum(["openai", "anthropic", "replay"]).default("openai"),
    LLM_BASE_URL: z
      .url()
      .optional()
      .or(z.literal("").transform(() => undefined)),
    LLM_API_KEY: optionalString,
    LLM_MODEL: optionalString,
    LLM_MODEL_FALLBACKS: optionalString,
    LLM_JSON_MODE: z.enum(["json_schema", "json_object"]).default("json_schema"),
    LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
    // 1 = record every live LLM reply as a replay fixture.
    LLM_RECORD: flag,
    REPLAY_DIR: optionalString,
    // live: in replay mode, a missing fixture calls the live LLM instead of failing safe.
    LLM_REPLAY_FALLBACK: z.enum(["off", "live"]).default("off"),
    // Comma-separated hosts fetch_url may reach on loopback (never in production, decision I).
    FETCH_URL_DEV_ALLOW_HOSTS: optionalString,
    // Local-only sandboxed repo checks (ADR-010).
    RUN_CHECKS_ENABLED: flag,
  })
  .superRefine((env, ctx) => {
    const live = env.AGENTS_MODE === "live" && env.LLM_PROVIDER !== "replay";
    if (live && !env.LLM_API_KEY)
      ctx.addIssue({
        code: "custom",
        path: ["LLM_API_KEY"],
        message: "LLM_API_KEY is required for live agents",
      });
    if (live && !env.LLM_MODEL)
      ctx.addIssue({
        code: "custom",
        path: ["LLM_MODEL"],
        message: "LLM_MODEL is required for live agents",
      });
    if (
      env.LLM_BASE_URL &&
      env.NODE_ENV === "production" &&
      !env.LLM_BASE_URL.startsWith("https://")
    )
      ctx.addIssue({
        code: "custom",
        path: ["LLM_BASE_URL"],
        message: "LLM_BASE_URL must be https in production",
      });
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
  llm: {
    provider: Env["LLM_PROVIDER"];
    baseUrl: string;
    apiKey?: string;
    model?: string;
    fallbackModels: string[];
    jsonMode: Env["LLM_JSON_MODE"];
    timeoutMs: number;
    record: boolean;
    replayDir: string;
    replayFallback: boolean;
  };
  fetchUrlDevAllowHosts: string[];
  runChecksEnabled: boolean;
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
    llm: {
      provider: e.LLM_PROVIDER,
      baseUrl:
        e.LLM_BASE_URL ??
        (e.LLM_PROVIDER === "anthropic"
          ? "https://api.anthropic.com"
          : "https://api.openai.com/v1"),
      apiKey: e.LLM_API_KEY,
      model: e.LLM_MODEL,
      fallbackModels: (e.LLM_MODEL_FALLBACKS ?? "")
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean),
      jsonMode: e.LLM_JSON_MODE,
      timeoutMs: e.LLM_TIMEOUT_MS,
      record: e.LLM_RECORD,
      replayDir: e.REPLAY_DIR ?? "fixtures/replay",
      replayFallback: e.LLM_REPLAY_FALLBACK === "live",
    },
    // Decision I: loopback hosts only outside production.
    fetchUrlDevAllowHosts:
      e.NODE_ENV === "production"
        ? []
        : (e.FETCH_URL_DEV_ALLOW_HOSTS ?? "")
            .split(",")
            .map((h) => h.trim().toLowerCase())
            .filter(Boolean),
    runChecksEnabled: e.RUN_CHECKS_ENABLED && e.NODE_ENV !== "production",
  };
}
