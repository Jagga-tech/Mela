// Mac relay: the only piece that runs on the demo Mac. Run with: npm run relay
// Sends texts Mela queued in SpacetimeDB, and stores host replies back in SpacetimeDB. Outbound connections only.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { latestRowId, pollReplies, sendText } from "../src/integrations/imessage";
import { connectStdb } from "../src/lib/stdb";
import { tables } from "../src/lib/module_bindings";

const LAST_FILE = `${homedir()}/.mela-relay-last-rowid`; // survives restarts so no reply is missed or replayed
const inFlight = new Set<bigint>();

connectStdb("relay", process.env.RELAY_SPACETIMEDB_TOKEN).then(async (conn) => {
  console.log("[relay] connected");

  conn.db.relayOutbox.onInsert(async (_ctx, row) => {
    if (inFlight.has(row.id)) return;
    inFlight.add(row.id);
    const result = await sendText(row.to, row.body);
    await conn.reducers
      .markSent({ id: row.id, ok: result.ok, reason: result.ok ? "" : result.reason })
      .catch((err) => console.error("[relay] markSent failed:", String(err)));
    inFlight.delete(row.id);
    console.log(`[relay] text ${row.id} ${result.ok ? "sent" : "failed"}`);
  });
  conn.subscriptionBuilder().subscribe(tables.relayOutbox);

  let last = Number(safeRead(LAST_FILE)) || (await latestRowId());
  setInterval(async () => {
    try {
      for (const r of await pollReplies(last)) {
        await conn.reducers.receiveText({ chatRowId: BigInt(r.rowId), from: r.from, body: r.text });
        last = r.rowId;
        writeFileSync(LAST_FILE, String(last));
      }
    } catch (err) {
      console.error("[relay] reading replies failed:", String(err).slice(0, 200)); // retried next tick
    }
  }, 3000);
}, (err) => {
  console.error(String(err));
  process.exit(1);
});

function safeRead(path: string) {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
}
