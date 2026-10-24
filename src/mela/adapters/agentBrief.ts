// Maps between the agent backend's EventBrief (src/lib/types.ts, agent-demo-flow) and the web contract.
// The agent brief has no guest range, budget scope or requirement keys, so those are kept from the
// previous web brief and requirement labels are matched onto known keys.
import type { EventBrief as AgentBrief, Priority as AgentPriority } from "@/lib/types";
import type { EventBrief, EventRequirement, RequirementPriority } from "../contracts";
import { applyParsed, emptyBrief, requirementFromLabel } from "../domain/intake";

const fromAgentPriority: Record<AgentPriority, RequirementPriority> = { "must-have": "MUST_HAVE", preferred: "PREFERENCE", flexible: "FLEXIBLE" };
const toAgentPriority: Partial<Record<RequirementPriority, AgentPriority>> = { MUST_HAVE: "must-have", PREFERENCE: "preferred", FLEXIBLE: "flexible" };

export function toAgentBrief(b: EventBrief): AgentBrief {
  return {
    eventType: b.occasion,
    location: b.city,
    dateWindow: b.dateTarget ? { start: b.dateTarget, end: b.dateTarget } : null,
    guestCount: b.guestRange?.max ?? null,
    budgetUsd: b.budget.amountCents === null ? null : b.budget.amountCents / 100,
    feel: b.atmosphere,
    accessibility: b.requirements.filter((r) => r.key === "step_free_access").map(() => "step-free"),
    dietary: b.requirements.filter((r) => r.key === "vegetarian_options").map(() => "vegetarian"),
    preferences: b.requirements
      .filter((r) => r.key !== "capacity" && r.key !== "venue_budget" && toAgentPriority[r.priority])
      .map((r) => ({ label: r.label, priority: toAgentPriority[r.priority]! })),
  };
}

export function fromAgentBrief(a: AgentBrief, prev: EventBrief | null): { brief: EventBrief; changes: string[] } {
  const base = prev ?? emptyBrief();
  const sameMax = base.guestRange && a.guestCount === base.guestRange.max;
  const reqs: EventRequirement[] = [
    ...a.preferences.map((p) => requirementFromLabel(p.label, fromAgentPriority[p.priority])),
    // accessibility/dietary arrive as tags without a priority: the host sets it, we never guess
    ...a.accessibility.map((t) => requirementFromLabel(t, "UNSET")),
    ...a.dietary.map((t) => ({ ...requirementFromLabel(t, "UNSET"), appliesTo: "catering" as const })),
  ];
  return applyParsed(base, {
    occasion: a.eventType || undefined,
    city: a.location || undefined,
    dateTarget: a.dateWindow?.start ?? undefined,
    guestRange: a.guestCount && !sameMax ? { min: a.guestCount, max: a.guestCount } : undefined,
    budgetCents: a.budgetUsd === null ? undefined : Math.round(a.budgetUsd * 100),
    requirements: reqs,
  });
}
