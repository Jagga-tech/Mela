// Run: npx tsx scripts/imessage-poll.ts
// Forwards the host's iMessage replies to /api/webhooks/text-inbound.
// Setup: the terminal needs Full Disk Access (to read chat.db) and Automation permission for Messages.
import "./env";
import { latestRowId, pollReplies } from "../src/integrations/imessage";
import { isFromHost } from "../src/integrations/phone";

const hostEnv = process.env.MELA_HOST_PHONE;
if (!hostEnv) { console.error("MELA_HOST_PHONE is not set; add it to .env.local (the demo phone number)."); process.exit(1); }
const host: string = hostEnv;
const url = `${process.env.MELA_API ?? "http://localhost:3000"}/api/webhooks/text-inbound`;

async function main() {
  let last = await latestRowId();
  console.log(`[poll] watching for replies from ${host} after row ${last}`);
  for (;;) {
    try {
      for (const r of await pollReplies(last)) {
        if (isFromHost(r.from, host)) {
          try {
            const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: r.from, body: r.text }), signal: AbortSignal.timeout(10_000) });
            if (!res.ok) throw new Error(`forward failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
            console.log(`[poll] forwarded ${r.rowId} → ${res.status} ${await res.text()}`);
          } catch (e) {
            console.error(`[poll] forward ${r.rowId} failed, will retry`, String(e));
            break; // keep `last` so this row is retried next tick
          }
        }
        last = r.rowId;
      }
    } catch (e) {
      console.error("[poll] read failed", String(e));
    }
    await new Promise((res) => setTimeout(res, 2000));
  }
}
main().catch((e) => { console.error("[poll] failed to start (Full Disk Access for ~/Library/Messages/chat.db?)", String(e)); process.exit(1); });
