import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { hashDemoPath } from "./run.js";
import { DEMO_PRESETS } from "@paylock/schemas";

describe("demo path fixtures exist", () => {
  for (const preset of DEMO_PRESETS) {
    it(`${preset.key} has a recorded fixture`, () => {
      const hash = hashDemoPath(preset);
      const fixturePath = `fixtures/replay/${hash}.json`;
      expect(existsSync(fixturePath)).toBe(true);
    });
  }
});
