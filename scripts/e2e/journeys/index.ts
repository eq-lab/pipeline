// Journey registry, in run order; one module per journey: journeys/<chain>-<journey>.ts. See docs/e2e.md.

import type { Journey } from "../lib/journey";
import evmLoan from "./evm-loan";
import evmLp from "./evm-lp";
import evmRisk from "./evm-risk";
import stellarLoan from "./stellar-loan";
import stellarLp from "./stellar-lp";
import stellarRisk from "./stellar-risk";

export const journeys: Journey[] = [stellarLp, stellarLoan, stellarRisk, evmLp, evmLoan, evmRisk];
