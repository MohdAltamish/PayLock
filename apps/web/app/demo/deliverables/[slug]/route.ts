import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Demo deliverables (decision I), served verbatim from fixtures/deliverables
 * so the Verifier sees exactly the HTML the replay fixtures were recorded with.
 */
const DIR = path.resolve(process.cwd(), "../../fixtures/deliverables");
const SLUGS = new Set(["pass", "bad", "portfolio"]);

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!SLUGS.has(slug)) return new Response("Not found", { status: 404 });
  const html = await readFile(path.join(DIR, `${slug}.html`), "utf8");
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function POST() {
  // The demo contact form posts to .../pass/thanks; there is nothing to store.
  return new Response("<!doctype html><p>Thanks, your message was sent.</p>", {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
