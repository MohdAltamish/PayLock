import type { FastifyInstance, FastifyPluginAsync } from "fastify";

/**
 * Minimal fastify-plugin equivalent: marks a plugin so its hooks and
 * decorators apply to the parent scope instead of an encapsulated child.
 */
export default function fp<O>(
  fn: (app: FastifyInstance, opts: O) => Promise<void>,
): FastifyPluginAsync<O & Record<never, never>> {
  const plugin = fn as unknown as FastifyPluginAsync<O & Record<never, never>> & {
    [k: symbol]: unknown;
  };
  plugin[Symbol.for("skip-override")] = true;
  return plugin;
}
