import { applyParsed, answerQuestion, confirmBrief, emptyBrief, parseIntakeText, setRequirementPriority } from "../src/mela/domain/intake";
import * as fx from "../src/mela/fixtures/oakland-baby-shower";
import type { EventBrief } from "../src/mela/contracts";

/** The demo scenario's brief after the host answers "venue only" and marks capacity + venue cap as must-haves. */
export function demoBrief(): EventBrief {
  let b = applyParsed(emptyBrief(), parseIntakeText(fx.scenario.exampleText)).brief;
  b = answerQuestion(b, null, "venue only").brief;
  b = setRequirementPriority(setRequirementPriority(b, "capacity", "MUST_HAVE"), "venue_budget", "MUST_HAVE");
  return confirmBrief(b);
}
