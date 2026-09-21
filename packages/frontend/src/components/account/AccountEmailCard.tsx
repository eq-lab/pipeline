// spec: docs/frontend/account-page.md#accountemailcard
import { AccountIconTile } from "./AccountIconTile";
import { AccountListRow } from "./AccountListRow";

function EnvelopeGlyph() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M17.5236 16.6903C17.4909 16.7099 17.4577 16.729 17.4235 16.7464C17.067 16.9281 16.5999 16.9279 15.6665 16.9279H4.3335C3.40007 16.9279 2.93302 16.9281 2.5765 16.7464C2.54211 16.7289 2.50852 16.71 2.47559 16.6903L8.02083 11.1442L8.17383 11.2972C8.32411 11.4475 8.4893 11.614 8.64339 11.7448C8.80877 11.8852 9.04183 12.0568 9.35628 12.159C9.77454 12.2949 10.2255 12.2949 10.6437 12.159C10.9582 12.0568 11.1912 11.8852 11.3566 11.7448C11.5107 11.614 11.6759 11.4475 11.8262 11.2972L11.9775 11.1442L17.5236 16.6903Z" />
      <path d="M7.13786 10.2612L1.73177 15.6665C1.66767 15.3472 1.66667 14.9207 1.66667 14.2611V6.26139C1.66667 5.60123 1.66751 5.17453 1.73177 4.85514L7.13786 10.2612Z" />
      <path d="M18.2674 4.85514C18.3317 5.17455 18.3333 5.60113 18.3333 6.26139V14.2611C18.3333 14.9208 18.3316 15.3472 18.2674 15.6665L12.8621 10.2612L18.2674 4.85514Z" />
      <path d="M15.6665 3.59456C16.5999 3.59456 17.067 3.59439 17.4235 3.77604C17.4576 3.7934 17.491 3.81183 17.5236 3.83138L10.9424 10.4134C10.6126 10.7432 10.4474 10.9082 10.2572 10.9701C10.09 11.0243 9.91001 11.0243 9.74284 10.9701C9.60011 10.9237 9.47114 10.8193 9.27653 10.6307L9.05762 10.4134L2.47559 3.83138C2.5084 3.81169 2.54223 3.7935 2.5765 3.77604C2.93302 3.59439 3.40008 3.59456 4.3335 3.59456H15.6665Z" />
    </svg>
  );
}

export interface AccountEmailCardProps {
  email?: string;
}

export function AccountEmailCard({ email }: AccountEmailCardProps) {
  return (
    <div className="flex w-full flex-col items-start gap-3">
      <p
        className={[
          "font-[family-name:var(--font-body)]",
          "text-[length:var(--text-pipeline-body)]",
          "leading-[var(--text-pipeline-body--line-height)]",
          "text-[color:var(--color-pipeline-ink)]",
        ].join(" ")}
      >
        Corporate email
      </p>
      <AccountListRow
        leading={
          <AccountIconTile>
            <EnvelopeGlyph />
          </AccountIconTile>
        }
        caption="Email"
        title={email ?? "—"}
        data-node-id="6701:98112"
      />
    </div>
  );
}

export default AccountEmailCard;
