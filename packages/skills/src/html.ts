/**
 * Small, dependency-free HTML facts for the Verifier: title, meta viewport,
 * form presence and a plain-text excerpt. Not a renderer (ADR-010).
 */
export interface HtmlFacts {
  title: string | null;
  metaViewport: string | null;
  hasForm: boolean;
  formFields: number;
  headings: string[];
  images: number;
  imageAlts: string[];
  textExcerpt: string;
}

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

export function htmlFacts(html: string, excerptChars = 4000): HtmlFacts {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? null;
  const meta = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const vp = meta.find((m) => /name\s*=\s*["']?viewport/i.test(m));
  const metaViewport = vp ? (/content\s*=\s*["']([^"']*)["']/i.exec(vp)?.[1] ?? "") : null;
  const forms = html.match(/<form\b[\s\S]*?<\/form>/gi) ?? [];
  const formFields = forms.reduce(
    (n, f) => n + (f.match(/<(input|textarea|select)\b/gi)?.length ?? 0),
    0,
  );
  const body = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const headings = [...body.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((m) =>
      decode(m[1]!.replace(/<[^>]+>/g, ""))
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .slice(0, 20);
  const imgs = [...body.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const imageAlts = imgs
    .map((t) => /alt\s*=\s*["']([^"']*)["']/i.exec(t)?.[1]?.trim() ?? "")
    .filter(Boolean)
    .map(decode)
    .slice(0, 20);
  const text = decode(body.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return {
    title: title ? decode(title) : null,
    metaViewport,
    hasForm: forms.length > 0,
    formFields,
    headings,
    images: imgs.length,
    imageAlts,
    textExcerpt: text.slice(0, excerptChars),
  };
}
