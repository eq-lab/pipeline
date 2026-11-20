import { runAdapterSpec } from "../../spec-domain/adapters"
import { runQuery } from "../../spec-domain/query"
import { runSpec } from "../../spec-domain/spec"
import { makeCheck } from "./run"

// What the runner runs against: this repo's toy domain. A project binds its
// own core, read models and adapters in the same file.
export const check = makeCheck({ runSpec, runQuery, runAdapterSpec })
