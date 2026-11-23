// Runs every spec under the repository's specs/ (specs/README.md, "Ratchet").
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { check } from "../scripts/specs/bindings.js";
import { repoRoot } from "../scripts/specs/files.js";
import { specSuite } from "../scripts/specs/suite.js";

await specSuite(
  check,
  {
    describe: (name, body) => void describe(name, body),
    it: Object.assign((name: string, body: () => void) => void it(name, body), {
      todo: (name: string) => void it.todo(name),
    }),
    fail: (message) => assert.fail(message),
  },
  repoRoot,
);
