import { describe, expect, it } from "vitest";
import { MONEY_LABEL, STATE_LABEL } from "../lib/copy";
import { getMoneyTone, getStateTone, MONEY_TONE_MAP, STATE_TONE_MAP } from "../lib/tone";

describe("tone mapping", () => {
  it("maps every money state in MONEY_LABEL to a valid tone and icon", () => {
    for (const state of Object.keys(MONEY_LABEL)) {
      expect(MONEY_TONE_MAP).toHaveProperty(state);
      const res = getMoneyTone(state);
      expect(res.tone).toMatch(/^(neutral|accent|success|warning|danger)$/);
      expect(res.icon).toBeDefined();
    }
  });

  it("maps every deal state in STATE_LABEL to a valid tone and icon", () => {
    for (const state of Object.keys(STATE_LABEL)) {
      expect(STATE_TONE_MAP).toHaveProperty(state);
      const res = getStateTone(state);
      expect(res.tone).toMatch(/^(neutral|accent|success|warning|danger)$/);
      expect(res.icon).toBeDefined();
    }
  });

  it("falls back gracefully for unknown states", () => {
    const unknownMoney = getMoneyTone("unknown_state");
    expect(unknownMoney.tone).toBe("neutral");
    expect(unknownMoney.icon).toBeDefined();

    const unknownDeal = getStateTone("UNKNOWN_STATE");
    expect(unknownDeal.tone).toBe("neutral");
    expect(unknownDeal.icon).toBeDefined();
  });
});

