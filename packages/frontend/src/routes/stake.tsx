import { createFileRoute } from "@tanstack/react-router";

/**
 * Stake route — placeholder. Full composition lands in a follow-up issue.
 *
 * Figma reference: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1497-95311&m=dev
 */
function Stake() {
  return <main>Stake</main>;
}

export const Route = createFileRoute("/stake")({
  component: Stake,
});
