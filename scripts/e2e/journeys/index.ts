// Journey registry, in run order; one module per journey: journeys/<chain>-<journey>.ts. See docs/e2e.md.

import type { Journey } from "../lib/journey";
import stellarLoan from "./stellar-loan";
import stellarLp from "./stellar-lp";

export const journeys: Journey[] = [stellarLp, stellarLoan];
