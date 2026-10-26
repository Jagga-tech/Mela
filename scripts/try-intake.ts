import "./env";
import { runIntake } from "../src/agents/intake";
import { findVendors } from "../src/agents/vendor";
import { explain } from "../src/agents/explainer";
import { buildCallScript } from "../src/agents/outreach";
import { extractQuote } from "../src/agents/quote";
import { store } from "../src/lib/store";
import { checkFit } from "../src/lib/rules";
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
  const third = await findVendors(store, first.data.brief, "venue", audit);
  console.log(JSON.stringify(third, null, 2));
  if (third.ok) {
    const items = [];
    for (const o of third.data.options) {
      const v = await store.getVendor(o.vendorId);
      if (v) items.push({ vendorId: v.id, name: v.name, ...checkFit(first.data.brief, v) });
    }
    console.log(JSON.stringify(await explain(items, audit), null, 2));
  }
  const venue = await store.getVendor("venue-casa-verde");
  if (venue) {
    console.log(JSON.stringify(await buildCallScript(venue, first.data.brief, ["Is the venue free on the first Saturday of December?", "What is the total price?", "Is a deposit required?"], audit), null, 2));
    console.log(JSON.stringify(await extractQuote("Agent: Is the venue free on the first Saturday of December? Vendor: Yes, we are open that day. Agent: What is the total price? Vendor: $4,000 for the evening. Agent: Is a deposit required? Vendor: Yes, a $500 deposit holds the date.", venue, audit), null, 2));
  }
}
}
main();
