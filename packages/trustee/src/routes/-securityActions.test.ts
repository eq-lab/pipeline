// spec: docs/frontend/trustee-flows.md#security-marks-1859
import { describe, it, expect } from "vitest";
import { buildSecurityActions } from "./-securityActions";
import { securityResult } from "./-riskCouncilFixtures";

const T = String(Date.UTC(2027, 0, 1) / 1000);

describe("buildSecurityActions", () => {
  it("is hidden until the security card is ready", () => {
    expect(
      buildSecurityActions(securityResult({ data: undefined, isLoading: true }))
        .state,
    ).toBe("hidden");
    expect(
      buildSecurityActions(securityResult({ data: { terms: null } })).state,
    ).toBe("hidden");
  });

  it("lists the served consents verbatim with dashes for missing fields", () => {
    const view = buildSecurityActions(
      securityResult({
        data: {
          terms: { advance_ratio_bps: 8000 },
          extension_consents: [
            {
              position: 0,
              consent_hash: "ab".repeat(32),
              new_maturity: T,
              at: T,
            },
            {},
          ],
        },
      }),
    );
    expect(view.state).toBe("ready");
    expect(view.consents[0]).toMatchObject({
      position: "#0",
      newMaturity: "1 Jan 2027",
      consentHash: "ab".repeat(32),
      recordedAt: "1 Jan 2027",
    });
    expect(view.consents[1]).toMatchObject({
      position: "—",
      newMaturity: "—",
      consentHash: "—",
      recordedAt: "—",
    });
  });

  it("has no consents for a missing list and carries the served coverage hints", () => {
    const none = buildSecurityActions(
      securityResult({ data: { terms: { advance_ratio_bps: 8000 } } }),
    );
    expect(none.consents).toEqual([]);
    expect(none.notes).toEqual([]);
    const noted = buildSecurityActions(
      securityResult({
        data: {
          terms: { advance_ratio_bps: 8000 },
          margin_call: {
            open: true,
            open_call_curable: true,
            ltv_above_ratio_no_onchain_call: true,
          },
        },
      }),
    );
    expect(noted.notes).toHaveLength(2);
  });
});
