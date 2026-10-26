import type { CallAttempt, CallOutcome, CallPlan } from "@/mela/contracts";
import { CallOutcome as CallOutcomeSchema } from "@/mela/contracts";
import { buildOutcome } from "@/mela/domain/calls";
import type { AgentTranscriptTurn } from "@/lib/calls/cartesia";

// Transcript -> CallOutcome, in code. No model is involved: each answer is the vendor's
// own words from the turns right after Mela asked that question, and every answer is
// checked to appear verbatim in the vendor's side of the transcript before it is kept.

export type Turn = CallAttempt["transcript"][number];

/** Cartesia roles: assistant = our agent, user = the person called, system = skipped. */
export function toTranscript(turns: AgentTranscriptTurn[] | null | undefined): Turn[] {
  return (turns ?? []).flatMap((t): Turn[] => {
    const text = (t.text ?? "").trim();
    if (!text) return [];
    if (t.role === "assistant") return [{ speaker: "mela" as const, text }];
    if (t.role === "user") return [{ speaker: "vendor" as const, text }];
    return [];
  });
}

export const normalize = (s: string) =>
  s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9$.,' ]+/g, " ").replace(/[.,]+(?=\s|$)/g, " ").replace(/\s+/g, " ").trim();

const STOP = new Set(["the", "and", "for", "you", "your", "are", "our", "any", "can", "what", "when", "how", "is", "do", "of", "to", "a", "an", "we", "it", "or", "there", "about", "with", "this", "that", "have", "does"]);
const words = (s: string) => normalize(s).split(" ").filter((w) => w.length > 2 && !STOP.has(w));

/** Share of the question's content words that the spoken turn contains. */
function overlap(question: string, turn: string): number {
  const q = new Set(words(question));
  if (!q.size) return 0;
  const t = new Set(words(turn));
  let hit = 0;
  for (const w of q) if (t.has(w)) hit++;
  return hit / q.size;
}

const ASKED_THRESHOLD = 0.6;

/** The disclosure's first sentence ("Hi, this is Mela, an AI assistant calling ...") must be in Mela's first turn. */
export function openedWithDisclosure(plan: CallPlan, transcript: Turn[]): boolean {
  const first = transcript.find((t) => t.speaker === "mela");
  if (!first) return false;
  const sentence = plan.disclosure.split(/(?<=[.?!])\s+/)[0] ?? plan.disclosure;
  return normalize(first.text).includes(normalize(sentence));
}

/** Code check: the span must appear, after normalizing case and spacing, in what the vendor said. */
export function vendorSaid(span: string, transcript: Turn[]): boolean {
  const n = normalize(span);
  if (!n) return false;
  const vendor = transcript.filter((t) => t.speaker === "vendor");
  return vendor.some((t) => normalize(t.text).includes(n)) || normalize(vendor.map((t) => t.text).join(" ")).includes(n);
}

/** For each planned question: the vendor turns between Mela asking it and Mela's next turn. */
export function pairAnswers(plan: CallPlan, transcript: Turn[]): (string | null)[] {
  let cursor = 0;
  return plan.questions.map((question) => {
    let asked = -1;
    for (let i = cursor; i < transcript.length; i++) {
      if (transcript[i]!.speaker === "mela" && overlap(question, transcript[i]!.text) >= ASKED_THRESHOLD) {
        asked = i;
        break;
      }
    }
    if (asked < 0) return null; // never asked, so not answered (later questions can still match)
    const said: string[] = [];
    let i = asked + 1;
    for (; i < transcript.length && transcript[i]!.speaker === "vendor"; i++) said.push(transcript[i]!.text);
    cursor = i;
    const answer = said.join(" ").trim();
    // Verify in code before keeping it.
    return answer && said.every((s) => vendorSaid(s, transcript)) ? answer : null;
  });
}

/** One unambiguous dollar amount in the vendor's own words, in cents. Ranges, several amounts, or words give null. */
export function spokenDollars(answer: string | null): number | null {
  if (!answer) return null;
  if (/\d\s*(?:-|–|to)\s*\$?\s*\d/.test(answer)) return null; // a range is not a price
  const amounts = new Set<number>();
  const add = (whole: string, frac?: string) => amounts.add(Number(whole.replace(/,/g, "")) * 100 + Number(frac ?? 0));
  for (const m of answer.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?/g)) add(m[1]!, m[2]);
  for (const m of answer.matchAll(/\b(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?\s*(?:dollars|bucks)\b/gi)) add(m[1]!, m[2]);
  return amounts.size === 1 ? [...amounts][0]! : null;
}

/**
 * Build the outcome for a finished call. Reuses domain buildOutcome (availability is only
 * needs_confirmation or vendor_said_verbally, never booked), then validates against the contract.
 */
export function outcomeFromTranscript(attemptId: string, plan: CallPlan, transcript: Turn[], now = new Date()): CallOutcome {
  const answers = pairAnswers(plan, transcript);
  const priceIdx = plan.questions.findIndex((q) => /rental fee|price per guest/i.test(q));
  const answer = priceIdx >= 0 ? (answers[priceIdx] ?? null) : null;
  const cents = spokenDollars(answer);
  const perGuest = priceIdx >= 0 && /per guest/i.test(plan.questions[priceIdx]!);
  const outcome = buildOutcome(attemptId, plan, answers, perGuest ? null : cents, now);
  if (cents !== null) {
    outcome.price = perGuest
      ? { priceType: "verbal", amountCents: null, unit: "per_guest", unitCents: cents, factIds: [], note: `Said on the call, per guest. Not a written quote: "${answer}"` }
      : { ...outcome.price!, note: `Said on the call. Not a written quote: "${answer}"` };
  }
  return CallOutcomeSchema.parse(outcome);
}
