import type { FetchLike } from "../paypal/token.js";

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

type Reply =
  { status: number; body?: unknown; headers?: Record<string, string> } | { error: Error };

/**
 * Scripted fetch for PayPal tests. Each call consumes the next reply for the
 * first matching route. Records every request for assertions.
 */
export function fakeFetch(
  routes: Array<{ match: (url: string, method: string) => boolean; replies: Reply[] }>,
) {
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    calls.push({ url, method, headers, body: init?.body as string | undefined });
    const route = routes.find((r) => r.match(url, method));
    if (!route) throw new Error(`fakeFetch: no route for ${method} ${url}`);
    const reply = route.replies.length > 1 ? route.replies.shift()! : route.replies[0];
    if (!reply) throw new Error(`fakeFetch: no reply left for ${method} ${url}`);
    if ("error" in reply) throw reply.error;
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  };
  return { fetch, calls };
}

export const tokenRoute = (expiresIn = 32400, token = "tok-1") => ({
  match: (url: string) => url.endsWith("/v1/oauth2/token"),
  replies: [
    { status: 200, body: { access_token: token, expires_in: expiresIn, scope: "a b" } },
  ] as Reply[],
});
