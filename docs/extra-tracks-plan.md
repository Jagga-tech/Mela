# Mela: Claude, SpacetimeDB and Fetch.ai tracks

Draft, Oct 23 2026. Builds on `docs/multi-agent-harness.md`.

## 1. Anthropic: Best Use of Claude

Prize confirmed at Cal Hacks 12.0; **confirm for 13.0**. No new build. It's how we pitch what we already have.

What to show judges:
- **A real multi-agent harness:** the Claude Lead agent plans and assigns work to 9 specialists, all through one `runAgent()` harness, each with a fixed output schema.
- **"The model interprets, code decides":** agents read, extract, explain and plan. Code-only tools do the money, the rules and the approval gates, and refuse if the Lead tries to skip them. Show one refusal live, e.g. `pay()` refusing during a finance hold.
- **Never guesses:** bad output → retry → `null` → shown as *unknown*. Every fact is cited.
- **Audit trail:** every agent run, tool call and approval appears on the dashboard timeline.
- **Built with Claude Code:** the team used it, plus the CRS and Visa MCP servers, to build.

## 2. SpacetimeDB: live shared workspace

Anchor sponsor; prize to confirm. We move it **from stretch to core.**

What it holds: the **live event state**, meaning brief, tasks, shortlist/cart, approvals, finance holds, payments, audit events and notifications. Every screen subscribes, so the host and planner dashboards update the moment an agent or a person changes something.

```
Agents / code-only tools ──write via reducers──▶ SpacetimeDB ──subscriptions──▶ Host dashboard
                                                                              └▶ Planner dashboard
```

- **Reducers are our gates.** The approval and payment checks (`approve`, `hold`, `release`, mandate checks) run as SpacetimeDB reducers, so the rule lives next to the data and no client can write around it.
- **Demo moment:** two laptops side by side. The Cartesia call starts on one phone, the host dashboard fills in live, and the planner's screen shows the same thing. When the invoice is held, both screens turn red at once.
- **The data team's vendor/venue dataset:** it can stay where the data team keeps it, or be loaded into SpacetimeDB so there's one DB. **Data team's call**; either way the agents read through `dbTools.ts`.
- SpacetimeDB's React quickstart generates TypeScript bindings, which fits our Next.js stack.

## 3. Fetch.ai: Best Use of Fetch.ai

> **Decision (Oct 23): later, only if we need an improvement.** Cartesia vendor calls are the only vendor path for now. Revisit F1/F2 once the main demo works.

**Confirmed:** $1,250 / $750 / $500 + internship interviews, and 2 × $250 special recognition. At Cal Hacks 12.0 the rules were: register agents on **Agentverse**, enable the **Chat Protocol**, and use Claude (or any LLM) as the reasoning engine. Check the 13.0 hackpack for this year's rules.

**What we use Fetch.ai for: agent-to-agent vendor quotes, plus a third way for hosts to reach Mela.**

### F1. Vendors as agents (main use)

Our vendors are other Cal Hacks teams. Each one gets a **Fetch.ai vendor agent** (uAgent) registered on Agentverse. When the host approves outreach, Mela can ask for a quote **agent to agent** instead of, or before, a phone call:

```
Mela Lead → request_quote (approved) → Mela uAgent ──Chat Protocol──▶ Vendor uAgent
                                                                  ◀── structured quote
                         → Bill Intake / Hyphenate PO flow
```

- Quotes come back as **structured data** (line items, price, terms), so there's no transcript to parse. That makes the Hyphenate flow cleaner.
- The vendor agent answers from that vendor's own data (price list, availability). The vendor team can tweak it live during the demo.
- Fallback: the Cartesia vendor call, unchanged.
- Same gate as calls: no outreach without the host's approval of the exact request.

### F2. Mela on ASI:One (second use)

Register the **Mela agent** on Agentverse with the Chat Protocol so anyone can reach it from **ASI:One** (Fetch.ai's agent chat) by typing "plan an outdoor quinceañera in SF for 100 people". It calls the same `start_task` backend as the phone line, and results land on the same dashboard and in iMessage.

So hosts can reach Mela by **phone (Cartesia), web, or ASI:One (Fetch.ai)**, all into one Lead agent.

### What we don't use Fetch.ai for

Payments. Money only moves through the Visa mandate flow, so there's one money path to audit.

### Build notes

- uAgents is Python. Add a small `fetch/` service (one uAgent for Mela, one template vendor uAgent) that forwards messages to our Next.js API (`POST /api/fetch/inbound`).
- Agentverse promo from the Fetch.ai event page: one month of ASI:One Pro + Agentverse Premium (the code on the page looks garbled, so confirm it at the booth).

## Build priority across these three

1. **Claude:** zero extra work, just the pitch and one live refusal.
2. **SpacetimeDB:** live state + reducers. It also *is* our dashboard backend, so it isn't extra.
3. **Fetch.ai F2** (Mela on ASI:One): small, one agent.
4. **Fetch.ai F1** (vendor agents): bigger win, more work. Do it after the main demo path works.

## Ask at the booths

- **Anthropic:** Is there a Claude prize at 13.0, and what do they judge on?
- **SpacetimeDB:** Prize? Is hosted SpacetimeDB (maincloud) fine for the demo?
- **Fetch.ai:** 13.0 rules: Agentverse + Chat Protocol required? Does agent-to-agent quoting with vendor agents count as "best use"?
