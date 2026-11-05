/**
 * List the tools exposed by the PayPal sandbox MCP server and save them to
 * docs/mcp-tools.txt (Day 1, C1-C4). Usage: npm run mcp:list-tools
 *
 * Authenticates with the APP's own client-credentials token (invariant 10),
 * never the coding assistant's toolkit token. Probes two read-only tools
 * (list_disputes, list_transactions) and records only status and counts,
 * never their contents. No write tool is ever called.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { scriptClient } from "./lib/paypal-client.js";

const SSE_URL = "https://mcp.sandbox.paypal.com/sse";
const OUT = path.resolve(import.meta.dirname, "../docs/mcp-tools.txt");
const READ_PROBES = ["list_disputes", "list_transactions"] as const;

const { tokens } = scriptClient();
const token = await tokens.getToken();
const authFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
};

const transport = new SSEClientTransport(new URL(SSE_URL), {
  eventSourceInit: { fetch: authFetch },
  requestInit: { headers: { Authorization: `Bearer ${token}` } },
});
const client = new Client({ name: "paylock-mcp-list-tools", version: "0.1.0" });

const lines: string[] = [];
const out = (s = "") => lines.push(s);

try {
  await client.connect(transport);
  const server = client.getServerVersion();
  const { tools } = await client.listTools();
  if (!tools.length) throw new Error("server returned no tools");
  tools.sort((a, b) => a.name.localeCompare(b.name));

  out("PayPal sandbox MCP tool list");
  out(`Generated: ${new Date().toISOString()} by scripts/mcp-list-tools.ts`);
  out(`Endpoint:  ${SSE_URL} (SSE transport)`);
  out(`Auth:      app client-credentials token (not the coding assistant's token)`);
  out(`Server:    ${server?.name ?? "?"} ${server?.version ?? ""}`.trimEnd());
  out(`Tools:     ${tools.length}`);
  out();
  for (const t of tools) {
    const props = Object.keys((t.inputSchema as { properties?: object })?.properties ?? {});
    const desc = (t.description ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
    out(`- ${t.name}`);
    if (desc) out(`    ${desc}`);
    out(`    params: ${props.length ? props.join(", ") : "(none)"}`);
  }

  out();
  out("Read-only probes (status only; results are not recorded):");
  const names = new Set(tools.map((t) => t.name));
  for (const probe of READ_PROBES) {
    if (!names.has(probe)) {
      out(`- ${probe}: NOT EXPOSED`);
      continue;
    }
    try {
      const r = await client.callTool({ name: probe, arguments: {} });
      const content = Array.isArray(r.content) ? r.content : [];
      const text = content
        .map((c) => (c && typeof c === "object" && "text" in c ? String(c.text) : ""))
        .join(" ");
      // The server reports failures in the body ({"ok":false,"code":...}) with isError=false.
      const failure = bodyFailure(text);
      const status =
        r.isError || failure
          ? `FAILED (${failure ?? text.replace(/\s+/g, " ").slice(0, 160)})`
          : `OK (${content.length} content part(s), ${text.length} chars; contents not recorded)`;
      out(`- ${probe}: ${status}`);
    } catch (err) {
      out(`- ${probe}: CALL FAILED (${(err as Error).message.slice(0, 160)})`);
    }
  }
  out();
  out("Paylock policy: MCP tools are read-only enrichment at runtime. Write tools");
  out("(create_order, pay_order, invoices, subscriptions, ...) are never called.");
} catch (err) {
  out("PayPal sandbox MCP tool list");
  out(`Generated: ${new Date().toISOString()} by scripts/mcp-list-tools.ts`);
  out(`Endpoint:  ${SSE_URL}`);
  out(`RESULT:    connection failed: ${(err as Error).message.slice(0, 300)}`);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}

/** Error code and message from a {"ok":false,...} tool body; never returns data. */
function bodyFailure(text: string): string | undefined {
  try {
    const j = JSON.parse(text) as { ok?: boolean; code?: string; message?: string };
    if (j && j.ok === false)
      return `${j.code ?? "ERROR"}: ${String(j.message ?? "").slice(0, 120)}`;
  } catch {
    // not JSON: treat as data
  }
  return undefined;
}

writeFileSync(OUT, lines.join("\n") + "\n");
console.log(lines.join("\n"));
console.log(`\nWrote ${path.relative(process.cwd(), OUT)}`);
