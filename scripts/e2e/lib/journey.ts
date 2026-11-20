// Journey and check types of the e2e harness; see docs/e2e.md.

export const CHAINS = ["stellar", "evm"] as const;
export type Chain = (typeof CHAINS)[number];

export type Recorded = Record<string, unknown>;

export interface StackState {
  tag?: string;
  chains?: Chain[];
  contracts?: { stellar?: string; evm?: string };
  durations?: { up?: number };
  startedAt?: string;
  ports?: Record<string, number>;
}

export interface JourneyContext {
  tag: string;
  state: StackState;
  recorded: Recorded;
}

export interface Step {
  name: string;
  run(ctx: JourneyContext): Promise<void> | void;
}

export interface CheckOutcome {
  ok: boolean;
  details?: string;
}

export interface Check {
  id: string;
  title: string;
  evaluate(recorded: Recorded): CheckOutcome;
}

export interface Journey {
  chain: Chain;
  name: string;
  steps: Step[];
  checks: Check[];
}

export const journeyId = (j: Journey) => `${j.chain}-${j.name}`;
