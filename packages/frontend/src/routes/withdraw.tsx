import { createFileRoute, redirect } from "@tanstack/react-router";

// spec: docs/frontend/dashboard-components.md#deposit-and-withdraw-route (redirect)
export const Route = createFileRoute("/withdraw")({
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/deposit",
      search: {
        ...(search as Record<string, unknown>),
        direction: "withdraw" as const,
      },
      replace: true,
    });
  },
});
