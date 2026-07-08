import { Button } from "@pipeline/ui";
import { LockIcon } from "@/components/LockIcon";

/**
 * SignInCard — the "Login Prompt" card from the Trustee sign-in overlay
 * (Figma node `4174:33891`, frame `4174-31660`, "Unauthenticated Overlay").
 *
 * Pixel/token mapping from the Figma export (see issue #787):
 *   - Card: white surface, `border-[rgba(50,56,55,0.18)]` → matches
 *     `--color-pipeline-line` (same rgb/alpha), `rounded-[24px]` (no existing
 *     radius token is 24px — `--radius-pipeline-card-lg` is 16px — so this is
 *     a documented one-off arbitrary value), `p-[32px]` / `gap-[24px]`,
 *     fixed `w-[520px]`, subtle `backdrop-blur` (Figma "Blur" effect,
 *     radius 32).
 *   - Icon badge: navy circle, `size-[56px]`, `rounded-[28px]` (= a perfect
 *     circle at this size), fill `--color-pipeline-brand` (`#000080` — exact
 *     token match), centered white 24px `LockIcon`.
 *   - Heading: Besley display serif, 36px/46px line-height, ink token.
 *   - Subtext: body 16px/22px, ink-muted token.
 *   - Actions: full-width black pill button (`--color-pipeline-cta` fill,
 *     `--radius-pipeline-pill` radius, 48px tall) labelled "Connect Wallet";
 *     caption footer, ink-muted, centered.
 *
 * The "Connect Wallet" button is a documented UI-only no-op — wiring to the
 * wallet/session layer is deferred to #778 (see
 * docs/exec-plans/tech-debt-tracker.md).
 */
export function SignInCard() {
  return (
    <div
      className={[
        "flex w-[520px] max-w-full flex-col items-start gap-6 p-8",
        "rounded-[24px] border border-solid",
        "border-[color:var(--color-pipeline-line)]",
        "bg-[color:var(--color-pipeline-surface)]",
        // Figma "Blur" effect (background blur, radius 32) — no shared token,
        // scoped to this card only.
        "backdrop-blur-[16px]",
      ].join(" ")}
      data-testid="sign-in-card"
    >
      <div className="flex w-full flex-col items-center gap-3">
        <div
          className="flex size-14 shrink-0 items-center justify-center rounded-[28px] bg-[color:var(--color-pipeline-brand)]"
          aria-hidden="true"
        >
          <LockIcon className="text-[color:var(--color-pipeline-on-dark)]" />
        </div>

        <div className="flex w-full flex-col items-center gap-2 text-center">
          <h1 className="w-full font-[family-name:var(--font-display)] text-[36px] leading-[46px] text-[color:var(--color-pipeline-ink)]">
            Sign in to access Pipeline
          </h1>
          <p className="w-full font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)] leading-[var(--text-pipeline-body--line-height)] text-[color:var(--color-pipeline-ink-muted)]">
            Connect your wallet to unlock the dashboard, metrics, and deal
            activity.
          </p>
        </div>
      </div>

      <div className="flex w-full flex-col items-start gap-3">
        <Button
          variant="primary-dark"
          // `!` overrides Button's built-in `rounded-[var(--radius-pipeline-button)])`
          // and `min-w-12` — same pattern the Button component itself uses for
          // its `compact` size override (Tailwind v4 equal-specificity hazard,
          // Issue #357). Figma's `radius/radius-full` (240px) maps to the
          // existing pill token.
          className="!w-full !min-w-0 !rounded-[var(--radius-pipeline-pill)]"
          onClick={() => {
            // TODO(#778): wire to the wallet/session layer. UI-only per
            // issue #787 — no network call, no redirect.
          }}
        >
          Connect Wallet
        </Button>
        <p className="w-full text-center font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-caption)] leading-[var(--text-pipeline-caption--line-height)] text-[color:var(--color-pipeline-ink-muted)]">
          No account? Contact your administrator.
        </p>
      </div>
    </div>
  );
}

export default SignInCard;
