// Server-only Cartesia helpers for in-app voice (batch STT + TTS bytes). The key never leaves the server.
if (typeof window !== "undefined") throw new Error("server only");

export const CARTESIA_VERSION = "2026-08-14";
export const DEFAULT_VOICE_ID = "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4"; // example voice from Cartesia's TTS docs; override with CARTESIA_VOICE_ID

export const cartesiaKey = () => process.env.CARTESIA_API_KEY || null;
export const voiceId = () => process.env.CARTESIA_VOICE_ID || DEFAULT_VOICE_ID;
export const notConfigured = () => Response.json({ error: "Cartesia voice isn't configured (CARTESIA_API_KEY missing)." }, { status: 503 });
