import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * /withdraw is now a one-time redirect to /deposit?direction=withdraw.
 * Direction is driven by the search param on /deposit; the route file is kept
 * so external links / bookmarks to /withdraw continue to work.
 *
 * `replace: true` keeps the redirect out of the back-button history so users
 * who reload do not see /withdraw flash before /deposit, and back-button does
 * not accumulate redirect hops. Any incoming search params are preserved.
 */
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
