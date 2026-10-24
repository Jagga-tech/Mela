import { cartesiaKey, voiceId } from "../cartesia";

export const dynamic = "force-dynamic";

export function GET() {
  const on = !!cartesiaKey();
  return Response.json({ cartesia: on, voiceId: on ? voiceId() : null });
}
