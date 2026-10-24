// One-time: create a test-mode connected Stripe account per seed vendor, so deposits land in a
// vendor-named balance. Prints STRIPE_ACCT_* lines to paste into .env.local. Safe to rerun (skips existing).
import "./env";
import { readFileSync } from "node:fs";

const key = process.env.STRIPE_SECRET_KEY;
if (!key || !/^(sk|rk)_test_/.test(key)) throw new Error("STRIPE_SECRET_KEY (test mode) is required");
const vendors = JSON.parse(readFileSync("data/seed.json", "utf8")).vendors as { id: string; name: string; phone: string }[];

async function stripe(path: string, params: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, { method: "POST", body: new URLSearchParams(params),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" } });
  const j = await res.json();
  if (!res.ok) throw new Error(`${path}: ${j.error?.message}`);
  return j;
}

async function main() {
for (const v of vendors) {
  if (process.env[`STRIPE_ACCT_${v.id}`]) { console.log(`STRIPE_ACCT_${v.id}=${process.env[`STRIPE_ACCT_${v.id}`]}  # exists`); continue; }
  const [first, ...rest] = v.name.split(" ");
  // test-mode Custom account with every field Stripe needs to activate transfers; payouts manual so the balance stays visible
  const a = await stripe("accounts", {
    type: "custom", country: "US", email: `${v.id}@example.com`, business_type: "individual",
    "capabilities[transfers][requested]": "true", "business_profile[name]": v.name, "business_profile[mcc]": "7299",
    "business_profile[product_description]": "Event vendor (Mela demo)",
    "tos_acceptance[date]": String(Math.floor(Date.now() / 1000)), "tos_acceptance[ip]": "127.0.0.1",
    "tos_acceptance[service_agreement]": "recipient",
    "individual[first_name]": first, "individual[last_name]": rest.join(" ") || "Vendor", "individual[email]": `${v.id}@example.com`,
    "individual[phone]": "0000000000", "individual[dob][day]": "1", "individual[dob][month]": "1", "individual[dob][year]": "1901",
    "individual[ssn_last_4]": "0000", "individual[address][line1]": "address_full_match", "individual[address][city]": "Berkeley",
    "individual[address][state]": "CA", "individual[address][postal_code]": "94704", "individual[address][country]": "US",
    "external_account": "btok_us_verified", "settings[payouts][schedule][interval]": "manual",
    "metadata[vendorId]": v.id,
  });
  console.log(`STRIPE_ACCT_${v.id}=${a.id}  # ${v.name}, transfers: ${a.capabilities?.transfers}`);
}
}
main().catch((e) => { console.error(e.message); process.exit(1); });
