// Mela texting bridge. Mela on Azure ("app") queues texts in outbox; the Mac relay ("relay") sends them
// with iMessage and writes host replies into inbox. Tables are private: each side only sees its own view.
import { schema, table, t, SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';

const outbox = table(
  { name: 'outbox' },
  {
    id: t.u64().primaryKey().autoInc(),
    to: t.string(),
    body: t.string(),
    taskId: t.string(), // the HumanTask this text belongs to ("" for plain updates)
    status: t.string().index('btree'), // pending | sent | failed
    reason: t.string(),
    createdAt: t.timestamp(),
  }
);

const inbox = table(
  { name: 'inbox' },
  {
    id: t.u64().primaryKey().autoInc(),
    chatRowId: t.i64().unique(), // Messages ROWID on the Mac, so a reply is stored once
    from: t.string(),
    body: t.string(),
    handled: t.bool().index('btree'),
    receivedAt: t.timestamp(),
  }
);

// Which identity is the app and which is the relay.
// ponytail: first identity to claim a role keeps it; claim both right after publishing. Swap for OIDC if this goes beyond the demo.
const role = table(
  { name: 'role' },
  {
    name: t.string().primaryKey(), // app | relay
    who: t.identity(),
  }
);

const spacetimedb = schema({ outbox, inbox, role });
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

function requireRole(ctx: Ctx, name: string) {
  const r = ctx.db.role.name.find(name);
  if (!r || !r.who.equals(ctx.sender)) throw new SenderError(`only the ${name} can do this`);
}

export const claimRole = spacetimedb.reducer({ name: t.string() }, (ctx, { name }) => {
  if (name !== 'app' && name !== 'relay') throw new SenderError('role must be app or relay');
  const existing = ctx.db.role.name.find(name);
  if (existing) {
    if (existing.who.equals(ctx.sender)) return;
    throw new SenderError(`${name} is already claimed`);
  }
  ctx.db.role.insert({ name, who: ctx.sender });
});

// App → queue a text.
export const queueText = spacetimedb.reducer(
  { to: t.string(), body: t.string(), taskId: t.string() },
  (ctx, { to, body, taskId }) => {
    requireRole(ctx, 'app');
    if (!to || !body) throw new SenderError('to and body are required');
    ctx.db.outbox.insert({ id: 0n, to, body, taskId, status: 'pending', reason: '', createdAt: ctx.timestamp });
  }
);

// Relay → report the result of a send.
export const markSent = spacetimedb.reducer(
  { id: t.u64(), ok: t.bool(), reason: t.string() },
  (ctx, { id, ok, reason }) => {
    requireRole(ctx, 'relay');
    const row = ctx.db.outbox.id.find(id);
    if (!row || row.status !== 'pending') return; // already reported, ignore the repeat
    ctx.db.outbox.id.update({ ...row, status: ok ? 'sent' : 'failed', reason });
  }
);

// Relay → store an incoming text. The same Messages row twice is ignored.
export const receiveText = spacetimedb.reducer(
  { chatRowId: t.i64(), from: t.string(), body: t.string() },
  (ctx, { chatRowId, from, body }) => {
    requireRole(ctx, 'relay');
    if (ctx.db.inbox.chatRowId.find(chatRowId)) return;
    ctx.db.inbox.insert({ id: 0n, chatRowId, from, body, handled: false, receivedAt: ctx.timestamp });
  }
);

// App → mark a reply as dealt with, so it leaves the app's inbox view.
export const markHandled = spacetimedb.reducer({ id: t.u64() }, (ctx, { id }) => {
  requireRole(ctx, 'app');
  const row = ctx.db.inbox.id.find(id);
  if (row && !row.handled) ctx.db.inbox.id.update({ ...row, handled: true });
});

// The relay sees only pending texts; anyone else sees nothing.
export const relayOutbox = spacetimedb.view({ name: 'relay_outbox', public: true }, t.array(outbox.rowType), ctx => {
  const r = ctx.db.role.name.find('relay');
  return r && r.who.equals(ctx.sender) ? [...ctx.db.outbox.status.filter('pending')] : [];
});

// The app sees only unhandled replies.
export const appInbox = spacetimedb.view({ name: 'app_inbox', public: true }, t.array(inbox.rowType), ctx => {
  const r = ctx.db.role.name.find('app');
  return r && r.who.equals(ctx.sender) ? [...ctx.db.inbox.handled.filter(false)] : [];
});

// The app sees every queued text with its status, so it can fall back to Twilio when one fails.
export const appOutbox = spacetimedb.view({ name: 'app_outbox', public: true }, t.array(outbox.rowType), ctx => {
  const r = ctx.db.role.name.find('app');
  return r && r.who.equals(ctx.sender) ? [...ctx.db.outbox.iter()] : [];
});
