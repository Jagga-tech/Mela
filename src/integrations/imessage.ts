// iMessage through the Messages app on the demo Mac (replaces Sendblue for the hackathon).
// Needs: Messages signed in to an Apple ID, Automation permission for Messages,
// and Full Disk Access for the terminal running the server (to read chat.db).
// ponytail: only works on the one Mac running the server; swap this file for Sendblue after the demo.
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";

const run = promisify(execFile);
const CHAT_DB = `${homedir()}/Library/Messages/chat.db`;

// Phone number and text go in as argv, never pasted into the script, so a message can't inject AppleScript.
const SEND_SCRIPT = `on run argv
  tell application "Messages"
    set svc to 1st account whose service type = iMessage
    send (item 2 of argv) to participant (item 1 of argv) of svc
  end tell
end run`;

export async function sendText(to: string, body: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await run("osascript", ["-e", SEND_SCRIPT, to, body], { timeout: 15_000 });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err).slice(0, 200) };
  }
}

export type Reply = { rowId: number; from: string; text: string };

// Returns incoming messages newer than sinceRowId. Caller keeps the last rowId and polls every few seconds.
export async function pollReplies(sinceRowId: number): Promise<Reply[]> {
  const sql = `SELECT m.ROWID AS rowId, h.id AS sender, m.text AS text, hex(m.attributedBody) AS body
    FROM message m JOIN handle h ON h.ROWID = m.handle_id
    WHERE m.is_from_me = 0 AND m.ROWID > ${Math.floor(sinceRowId)} ORDER BY m.ROWID`;
  const { stdout } = await run("sqlite3", ["-readonly", "-json", CHAT_DB, sql], { timeout: 10_000 });
  if (!stdout.trim()) return [];
  const rows = JSON.parse(stdout) as { rowId: number; sender: string; text: string | null; body: string | null }[];
  return rows
    .map((r) => ({ rowId: r.rowId, from: r.sender, text: r.text ?? decodeBody(r.body) ?? "" }))
    .filter((r) => r.text);
}

// Highest Messages ROWID right now, so a fresh relay starts from "now" instead of replaying the whole history.
export async function latestRowId(): Promise<number> {
  const { stdout } = await run("sqlite3", ["-readonly", CHAT_DB, "SELECT COALESCE(MAX(ROWID), 0) FROM message"], { timeout: 10_000 });
  return Number(stdout.trim()) || 0;
}

// Newer macOS leaves `text` empty and stores the message in attributedBody (an Apple typedstream).
// The string sits after "NSString": 5 header bytes, a length (1 byte, or 0x81 + 2 bytes little-endian), then UTF-8.
function decodeBody(hex: string | null): string | null {
  if (!hex) return null;
  const buf = Buffer.from(hex, "hex");
  const at = buf.indexOf("NSString");
  if (at < 0) return null;
  let i = at + "NSString".length + 5;
  let len = buf[i];
  if (len === 0x81) { len = buf.readUInt16LE(i + 1); i += 3; } else i += 1;
  return buf.subarray(i, i + len).toString("utf8");
}
