// Mela side (Azure) of texting. Agents and ask_human call textHost(); replies arrive through onHostReply().
// The Mac relay does the actual iMessage send/receive through SpacetimeDB.
import { connectStdb } from "./stdb";
import { tables, type DbConnection } from "./module_bindings";

type ReplyHandler = (reply: { from: string; body: string }) => Promise<void>;

let ready: Promise<DbConnection> | null = null;
const handlers: ReplyHandler[] = [];

function conn() {
  ready ??= connectStdb("app", process.env.SPACETIMEDB_TOKEN).then(
    (c) => {
      // Every unhandled reply goes to the handlers, then is marked handled so it is processed once.
      c.db.appInbox.onInsert(async (_ctx, row) => {
        for (const h of handlers) await h({ from: row.from, body: row.body }).catch((err) => console.error("[texting] handler failed:", String(err)));
        await c.reducers.markHandled({ id: row.id });
      });
      c.subscriptionBuilder().subscribe([tables.appInbox, tables.appOutbox]);
      return c;
    },
    (err) => {
      ready = null; // next call retries instead of failing forever
      throw err;
    }
  );
  return ready;
}

// Queues a text; the relay sends it within a second or two. Check appOutbox status for sent/failed.
export async function textHost(to: string, body: string, taskId = "") {
  const c = await conn();
  await c.reducers.queueText({ to, body, taskId });
}

export function onHostReply(handler: ReplyHandler) {
  handlers.push(handler);
  void conn();
}
