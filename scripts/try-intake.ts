import "./env";
import { runIntake } from "../src/agents/intake";
import type { AuditEvent } from "../src/lib/types";

async function main() {
const audit: AuditEvent[] = [];
const first = await runIntake(
  "I'm planning an outdoor quinceañera in San Francisco for about 100 people, step-free access, some vegetarian guests, budget around $12,000, first weekend of December",
  null,
  audit,
);
console.log(JSON.stringify(first, null, 2));
if (first.ok) {
  const second = await runIntake("actually make it 110 people", first.data.brief, audit);
  console.log(JSON.stringify(second.ok ? { changes: second.data.changes, guestCount: second.data.brief.guestCount } : second, null, 2));
}
}
main();
