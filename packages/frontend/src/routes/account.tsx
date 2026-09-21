// spec: docs/frontend/account-page.md#route
import { createFileRoute, redirect } from "@tanstack/react-router";
import { ENV } from "@/lib/env";
import { AccountPage } from "@/components/account/AccountPage";
import {
  parseAccountStatePreview,
  type AccountDocumentsState,
} from "@/components/account/accountPageState";

export const Route = createFileRoute("/account")({
  beforeLoad: () => {
    if (!ENV.IS_DEV) throw redirect({ to: "/" });
  },
  validateSearch: (raw): { state: AccountDocumentsState | undefined } => ({
    state: parseAccountStatePreview(raw.state),
  }),
  component: AccountRoute,
});

function AccountRoute() {
  const { state } = Route.useSearch();
  return <AccountPage previewState={state} />;
}
