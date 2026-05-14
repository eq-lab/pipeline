import { createFileRoute } from "@tanstack/react-router";

/**
 * Withdraw route — placeholder.
 *
 * Full page composition lands in a follow-up issue.
 *
 * Figma reference: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1498-100351&m=dev
 */
function Withdraw() {
  return <main>Withdraw</main>;
}

export const Route = createFileRoute("/withdraw")({
  component: Withdraw,
});
