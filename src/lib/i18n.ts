// Language data. Pure: no model calls here (translation lives in src/agents/translator.ts).
export const LANGUAGES = ["en", "hi", "pa", "vi"] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_NAMES: Record<Language, string> = { en: "English", hi: "Hindi", pa: "Punjabi", vi: "Vietnamese" };

export function asLanguage(code: unknown): Language {
  const c = typeof code === "string" ? code.trim().toLowerCase() : "";
  return (LANGUAGES as readonly string[]).includes(c) ? (c as Language) : "en";
}

const norm = (w: string) => w.normalize("NFC").toLowerCase();

export const YES_WORDS: readonly string[] = [
  "yes", "y", "ok", "okay", "approve", "confirm",
  "haan", "han", "haanji", "ji", "theek", "हाँ", "हां", "जी", "ठीक",
  "hanji", "ਹਾਂ", "ਹਾਂਜੀ", "ਠੀਕ",
  "có", "co", "vâng", "vang", "đồng ý", "dong y", "duoc", "được",
].map(norm);
export const NO_WORDS: readonly string[] = [
  "no", "n", "decline", "cancel",
  "nahi", "nahin", "na", "नहीं", "ना",
  "ਨਹੀਂ", "ਨਾ",
  "không", "khong",
].map(norm);

// ponytail: native-speaker check pending (hi, pa, vi)
export const DISCLOSURES: Record<Language, string> = {
  en: "Hi, this is Mela, an AI assistant calling on behalf of a client. This call is recorded and transcribed. Is now a good time?",
  hi: "नमस्ते, मैं मेला हूँ, एक AI सहायक, और एक क्लाइंट की ओर से कॉल कर रही हूँ। यह कॉल रिकॉर्ड और ट्रांसक्राइब की जा रही है। क्या अभी बात करने का सही समय है?",
  pa: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਮੈਂ ਮੇਲਾ ਹਾਂ, ਇੱਕ AI ਸਹਾਇਕ, ਅਤੇ ਇੱਕ ਕਲਾਇੰਟ ਵੱਲੋਂ ਕਾਲ ਕਰ ਰਹੀ ਹਾਂ। ਇਹ ਕਾਲ ਰਿਕਾਰਡ ਅਤੇ ਟ੍ਰਾਂਸਕ੍ਰਾਈਬ ਕੀਤੀ ਜਾ ਰਹੀ ਹੈ। ਕੀ ਹੁਣ ਗੱਲ ਕਰਨ ਦਾ ਠੀਕ ਸਮਾਂ ਹੈ?",
  vi: "Xin chào, tôi là Mela, trợ lý AI gọi thay mặt cho một khách hàng. Cuộc gọi này được ghi âm và chép lại thành văn bản. Bây giờ có tiện nói chuyện không ạ?",
};

// \p{M} is kept inside tokens: Devanagari and Gurmukhi vowel signs (ा ँ ਾ ਂ) are marks, not letters.
export const tokens = (body: string): string[] => norm(body).split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);

export function verbOf(body: string): "YES" | "NO" | null {
  const t = tokens(body);
  for (const w of [t.slice(0, 2).join(" "), t[0]]) {
    if (YES_WORDS.includes(w)) return "YES";
    if (NO_WORDS.includes(w)) return "NO";
  }
  return null;
}
