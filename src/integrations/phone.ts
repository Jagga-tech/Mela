export const digits = (s: string) => s.replace(/\D/g, "");
export const isFromHost = (from: string, hostPhone: string) => {
  const a = digits(from).slice(-10), b = digits(hostPhone).slice(-10);
  return a.length > 0 && a === b;
};
// "+<digits>", US 10-digit numbers get a leading 1; null when fewer than 10 digits.
export const normalizePhone = (s: string): string | null => {
  const d = digits(s);
  return d.length < 10 ? null : "+" + (d.length === 10 ? "1" + d : d);
};
// The poller stops re-forwarding an inbound row after this many failed attempts.
export const shouldGiveUp = (failures: number) => failures >= 3;
