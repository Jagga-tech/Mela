// Run: npm run cartesia:setup [-- --provision] [-- --write]
// Finds (or with --provision, provisions) a Cartesia number and creates or updates the "mela-caller" agent.
// Prints CARTESIA_AGENT_ID / CARTESIA_PHONE_NUMBER_ID; --write also saves them to .env.local. Never prints the API key.
import "./env";
import { readFileSync, writeFileSync } from "node:fs";
import { AGENT_NAME, agentConfig, cartesiaClient } from "../src/integrations/cartesia";

const args = process.argv.slice(2);
const DEFAULT_VOICE = "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4"; // the account's existing agent voice

async function main() {
  const c = cartesiaClient();
  let number = (await c.listPhoneNumbers())[0];
  if (!number) {
    if (!args.includes("--provision")) {
      console.log("No Cartesia phone number on this account. Re-run with --provision to get a free US number:\n  npm run cartesia:setup -- --provision");
      process.exit(1);
    }
    number = await c.provisionNumber("Mela");
    console.log(`[setup] provisioned number ${number.number ?? number.id}`);
  }
  const config = agentConfig(process.env.CARTESIA_VOICE_ID || DEFAULT_VOICE);
  const existing = (await c.listAgents()).find((a) => a.name === AGENT_NAME);
  const agentId = existing ? existing.id : (await c.createAgent(config)).id;
  if (existing) await c.updateAgent(existing.id, config);
  console.log(`[setup] ${existing ? "updated" : "created"} agent ${AGENT_NAME}; calls go out from ${number.number ?? number.id}`);
  const vars = { CARTESIA_AGENT_ID: agentId, CARTESIA_PHONE_NUMBER_ID: number.id };
  for (const [k, v] of Object.entries(vars)) console.log(`${k}=${v}`);
  if (!args.includes("--write")) { console.log("Add these to .env.local, or re-run with --write."); return; }
  let env = ""; try { env = readFileSync(".env.local", "utf8"); } catch { /* no file yet */ }
  for (const [k, v] of Object.entries(vars)) {
    const re = new RegExp(`^${k}=.*$`, "m");
    env = re.test(env) ? env.replace(re, `${k}=${v}`) : `${env}${env && !env.endsWith("\n") ? "\n" : ""}${k}=${v}\n`;
  }
  writeFileSync(".env.local", env);
  console.log("[setup] wrote .env.local");
}

main().catch((e) => { console.error("[setup] failed:", e instanceof Error ? e.message : e); process.exit(1); });
