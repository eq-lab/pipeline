// One spec block against the bindings (scripts/specs/bindings.ts): null when
// green, otherwise why it is red. Fixture paths resolve against root.
import { compare, compareValue } from "./compare.js";
import { fixtureExists, loadFixture } from "./fixtures.js";
import type { SpecMessage, SpecOutcome, ValueOutcome } from "./outcome.js";
import {
  type AdapterScenario,
  type Block,
  isAdapterScenario,
  isQueryScenario,
} from "./parse.js";

const thrown = (who: string, error: unknown) =>
  `${who} threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`;

export interface SpecBindings {
  readonly runSpec: (
    given: ReadonlyArray<SpecMessage>,
    when: SpecMessage,
    now: string | null,
  ) => SpecOutcome;
  readonly runQuery: (
    given: ReadonlyArray<SpecMessage>,
    query: SpecMessage,
    now: string | null,
  ) => ValueOutcome;
  readonly runAdapterSpec: (
    adapter: string,
    response: unknown,
    when: SpecMessage,
  ) => ValueOutcome;
}

export type Check = (block: Block, root?: string) => string | null;

const checkAdapter = (
  scenario: AdapterScenario,
  root: string,
  runAdapterSpec: SpecBindings["runAdapterSpec"],
): string | null => {
  const { response } = scenario;
  if (response._tag === "Fixture" && !fixtureExists(root, response.path)) {
    return `invalid spec: fixture ${response.path} not found`;
  }
  let value = response._tag === "Inline" ? response.value : undefined;
  if (response._tag === "Fixture") {
    try {
      value = loadFixture(root, response.path);
    } catch (error) {
      return `invalid spec: fixture ${response.path}: ${String(error)}`;
    }
  }
  try {
    return compareValue(
      scenario.then,
      runAdapterSpec(scenario.adapter, value, scenario.when),
    );
  } catch (error) {
    return thrown(`adapter ${scenario.adapter}`, error);
  }
};

export const makeCheck =
  ({ runSpec, runQuery, runAdapterSpec }: SpecBindings): Check =>
  (block, root = process.cwd()) => {
    const scenario = block.scenario;
    if ("error" in scenario) return `invalid spec: ${scenario.error}`;
    if (isAdapterScenario(scenario))
      return checkAdapter(scenario, root, runAdapterSpec);
    if (isQueryScenario(scenario)) {
      try {
        return compareValue(
          scenario.then,
          runQuery(scenario.given, scenario.query, scenario.now),
        );
      } catch (error) {
        return thrown("query", error);
      }
    }
    try {
      return compare(
        scenario.then,
        runSpec(scenario.given, scenario.when, scenario.now),
      );
    } catch (error) {
      return thrown("core", error);
    }
  };
