# Mela

Voice-first, AI-assisted event planning (Cal Hacks 13.0). A host describes an event; Mela researches real venues and caterers from their public pages, shows every fact with its quote and source, and asks before any outside action.

- Web app (screens, contracts, rules, adapters): `src/mela/`
- API routes: `src/app/api/` · server modules: `src/lib/{research,finance,calls,crs}`, `src/integrations/`
- Endpoints, demo vs live, payloads: [`docs/frontend-integration.md`](docs/frontend-integration.md)
- Research pipeline (Bright Data, Apify, extraction, verification, cache): [`docs/research.md`](docs/research.md)
- Design handoff (Figma map): [`docs/design-handoff.md`](docs/design-handoff.md)

## Run it locally

```bash
npm install
npm run dev            # http://localhost:3000, demo mode: no keys, fictional vendors, labeled as such
```

Click **Try the demo example** on the welcome screen.

## Tests

```bash
npm test                  # app, finance, CRS
npm run test:research     # research module (fakes, no network)
npm run test:calls        # call routes (fakes, no network)
npx tsc --noEmit
npx next build
```

The research and calls suites run with `--conditions=react-server` because those modules import `server-only`.

## Live mode

Each capability goes live on its own. List the ones you want in `NEXT_PUBLIC_MELA_LIVE` (`intake,research,calls,finance`, or `all`); everything else stays on the labeled demo. A live capability with missing keys shows "not connected", never fixture data.

Put keys in `.env.local` (never committed). They are read only in route handlers and `server-only` modules.

| Capability | Env vars |
|---|---|
| Intake | `ANTHROPIC_API_KEY` |
| Voice | `CARTESIA_API_KEY` (optional `CARTESIA_VOICE_ID`, `CARTESIA_TTS_MODEL`) |
| Research | `BRIGHTDATA_API_TOKEN` (or `BRIGHTDATA_API_KEY`), `BRIGHTDATA_UNLOCKER_ZONE`, `BRIGHTDATA_SERP_ZONE` (zone *names*, not keys), `ANTHROPIC_API_KEY`, `APIFY_TOKEN` |
| Finance test payment | `STRIPE_SECRET_KEY` (must be `sk_test_…`; live keys are refused) |
| CRS vendor check | `CRS_USERNAME`, `CRS_PASSWORD`; for OFAC also `CRS_XGS_CONFIG`, `CRS_XGS_GLB_PURPOSE`, `CRS_XGS_DL_PURPOSE`; optional `CRS_BASE_URL` |
| Calls | `CARTESIA_API_KEY`, `CARTESIA_AGENT_ID`, `CARTESIA_FROM_NUMBER_ID` (`ap_…`), `MELA_ROLEPLAY_PHONE` (E.164); optional `CARTESIA_WEBHOOK_SECRET`, `MELA_ROLEPLAY_LABEL` |

Run one long-lived server for live mode. Research jobs, finance cases, call plans and CRS results live in that process's memory, and the browser polls it:

```bash
npm run build && npm start
```

`NEXT_PUBLIC_*` values are baked in at build time, so rebuild after changing them.

### Setup outside the code

- **Cartesia (calls):** create one agent whose greeting is exactly `{{mela_disclosure}}`, with the instructions in `VENDOR_AGENT_SETUP` (`src/integrations/cartesia.ts`). It must read the questions word for word, or the answers come back `not_answered`. Calls only ever go to `MELA_ROLEPLAY_PHONE`, a consenting teammate, never a vendor's listed number. Optional webhook: `https://<host>/api/calls/webhook`.
- **CRS:** the hackathon sandbox's business-check access is unconfirmed. Until CRS confirms otherwise, check only their test businesses (send `{"business": {...}}` to `POST /api/vendors/:vendorId/risk`), never real vendor names.
- **Stripe:** test mode only. A test payment needs a released finance case, a human AP manager, and a `clear` CRS result less than 7 days old.

## Research from the terminal

```bash
npm run research:fetch -- https://palaceoffinearts.com/ --find "capacity"
npm run research:run -- --url https://palaceoffinearts.com/ --name "Palace of Fine Arts" --vendor "caterer"
npm run research:parks    # SF parks from DataSF, no keys
```

These load `.env.local`. Results are cached in `.research-cache/`; add `--fresh` to skip the cache.

**Ablation test** (proves nothing is hardcoded): every fact must come back `unknown` / `source_failed`.

```bash
BRIGHTDATA_API_TOKEN=bad npm run research:run -- --url https://palaceoffinearts.com/ --name "Palace of Fine Arts" --fresh
```
