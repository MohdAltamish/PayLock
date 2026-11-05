import type { z } from "zod";
import { ProblemError } from "./problem.js";

/** Parse untrusted input with Zod; 400 problem with field paths on failure (no values echoed). */
export function parseBody<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    throw new ProblemError(
      400,
      "validation-error",
      "Request validation failed",
      r.error.issues.map((i) => `${i.path.join(".") || "(body)"}: ${i.message}`).join("; "),
    );
  }
  return r.data;
}
