export const digits = (s: string) => s.replace(/\D/g, "");
export const isFromHost = (from: string, hostPhone: string) => {
  const a = digits(from).slice(-10), b = digits(hostPhone).slice(-10);
  return a.length > 0 && a === b;
};
