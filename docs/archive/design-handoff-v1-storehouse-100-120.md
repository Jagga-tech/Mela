# Mela — Design handoff (frontend)

Figma: https://www.figma.com/design/vCZexQrSHgrVtHctQ6g3S6

| Page | What's there |
|---|---|
| 01 — References & Visual Direction | Direction, reference takeaways (borrow/avoid), real sources, risks |
| 02 — Design System | Variables, text/effect styles, all components |
| 03 — Desktop Experiences | D1–D7 + D5b, clickable flow "Demo — Dream → Act" |
| 04 — Mobile Experiences | M1, M1b, M2, M3a, M3b, flow "Demo — mobile" |
| 05 — Demo Flow & Interaction States | 3-minute storyboard, voice states, 100→120→restore spec, system states, motion/a11y spec |

## Tokens (Figma collection "Mela Tokens")

Colors (light mode only):

```
bg/canvas #F6F1E9   bg/surface #FFFCF7   bg/sunken #EEE6DA   bg/inverse #241826
border/subtle #E4DACB   border/strong #CBBDA9
text/primary #241826   text/secondary #5E5162   text/tertiary #857A8A   text/inverse #FBF7F0
accent/lavender #8E78BC   accent/lavender-ink #5B4688   accent/lavender-soft #ECE5F5
accent/terracotta #B9603F   accent/terracotta-soft #F5E2D8
status/verified #3E6B4E (+soft #E1EDE3)    status/estimate #8A5A12 (+soft #F8ECD2)
status/unknown #6F6774 (+soft #ECE8EE)     status/conflict #B23A30 (+soft #FAE1DC)
twin/floor #EFE7DA  twin/wall #D6C9B6  twin/table #FFFDF8  twin/chair #C9BADB  twin/stage #E9D9CC
```

Spacing: 4 8 12 16 20 24 32 40 48 64 80 120. Radius: sm 8, md 12, lg 20, xl 28, pill 999.

Type (Google Fonts): **Instrument Serif** for display, **Instrument Sans** for UI, **Geist Mono** for data.
Display/XL 96/96, Display/L 64/68, Display/M 44/48, Display/S 30/36, Heading/L 22/28 (600), Heading/M 17/24 (600), Heading/S 15/20 (600), Body/L 18/28, Body/M 15/22, Body/S 13/18, Label/M 14/18 (500), Label/S 12/16 (500), Overline 11/14 (600, +8%, uppercase), Data/M 13 mono, Data/S 11 mono.

Elevation: Card (0 1 2 / 5% + 0 10 28 −6 / 7%), Float (0 2 6 / 8% + 0 24 56 −12 / 16%), Focus ring (0 0 0 3px lavender @55%).

## Components → suggested React components

| Figma | React | Notes |
|---|---|---|
| Button (Primary/Secondary/Ghost/Accent × L/M) | `<Button variant size>` | One Primary per view. L on mobile (44px+ target). |
| Evidence Badge (Verified/Estimate/Unknown/Conflict/Incompatible/Illustrative/Your input) | `<EvidenceBadge status>` | Always icon + label. Maps 1:1 to `EvidenceStatus`. |
| Status Icon | `<StatusIcon kind>` | Dense contexts (stats, tables). |
| Source Link | `<SourceLink source>` | Domain + "checked {date}"; opens URL. |
| Journey Step / App Header | `<JourneyNav current>` | Steps navigable; mobile shows "Step n of 6". |
| Voice Entry (Hero) ×6 states | `<VoiceEntry state>` | Welcome only. |
| Voice Dock ×6 states | `<VoiceDock state>` | Persistent on all other screens. |
| Guest Stepper (Within/Conflict) | `<GuestStepper>` | Writes `eventBrief.guestCount`. |
| Capacity Meter (Within/Over) | `<CapacityMeter result>` | Renders a `FeasibilityResult`; never computes. |
| Fact Row | `<FactRow claim>` | Claim value + evidence badge. |
| Assistant Note | `<AssistantNote>` | 1–2 sentences, replaces chat bubbles. |
| Toast | `<Toast action="Undo">` | 6s, focus returns to origin control. |
| Venue Card | `<VenueCard venue fit>` | Photo is "Representative" unless `photo.source` exists. |
| Brief Field | `<BriefField field>` | Number links to transcript highlight. |
| View Toggle 2D/3D | `<ViewToggle>` | Camera mode, not a route change. |
| Chip (Suggestion/Filter) | `<Chip>` | |
| System State (Loading/Empty/Source error/3D unavailable) | `<SystemState>` | |
| Approval Dialog | `<ApprovalDialog action>` | Required before any outbound action. |

## Breakpoints

- Desktop 1440 (designed), works ≥1200: Twin = full-bleed canvas + floating 252px Scene panel (left) + 360px Reality Check panel (right) + centered 640px dock.
- Tablet 768–1199 (not drawn): hide Scene panel behind a toggle; Reality Check becomes a right drawer.
- Mobile 390 (designed): Twin canvas on top, Reality Check as bottom sheet (peek ≈ 240px, expanded ≈ 440px); voice button lives in sheet header; editing limited to guests, arrangement, view toggle.

## Shared state contracts (proposal)

```ts
type EvidenceStatus = 'verified' | 'estimate' | 'unknown' | 'conflict' | 'incompatible' | 'illustrative' | 'user';
interface VenueSource { url: string; domain: string; retrievedAt: string; excerpt?: string }
interface Claim<T> { value: T | null; status: EvidenceStatus; source?: VenueSource }
interface Venue {
  id: string; name: string; area: string;
  dimensionsFt?: Claim<{ w: number; d: number; ceiling?: number }>;
  capacity: { banquet?: Claim<number>; max?: Claim<number>; theater?: Claim<number>; reception?: Claim<number> };
  price: Claim<string>; eventPolicies: Claim<string>[]; photo: { url: string; representative: boolean };
}
interface EventBrief { occasion; city; date: Claim<string>; guestCount: number; budget: Claim<[number, number]>; aesthetic: string[]; mustHaves: Claim<string>[]; accessibility: Claim<string>[] }
interface FeasibilityResult { status: 'within' | 'conflict' | 'unknown'; planned: number; limit: Claim<number> | null; format: 'banquet' | 'reception' | 'theater'; overBy?: number; layoutSeatsEstimate?: number }
type PlanningAction = { id; kind: 'inquiry' | 'hold' | 'payment' | 'research'; requiresApproval: boolean; status: 'draft' | 'approved' | 'sent' };
```

Capacity rule the UI expects: `limit = venue.capacity[format]`. Missing limit → `unknown` (never "fits"). `planned > limit` → `conflict`. A layout seat estimate never overrides a published limit.

## Interactions to build

- Push-to-talk (tap / Space), live transcript, editable transcript before interpretation, text fallback when mic is denied.
- Transcript phrases highlighted + numbered → Brief Field numbers.
- Venue card "Open in Twin" → shared-element expand into canvas.
- Guest stepper / voice "make it 120" → feasibility check → panel + scene update; Restore + Undo toast.
- 2D ↔ 3D camera ease 600ms; reduced motion = cut. Full motion table on page 05.

## Needs a 3D engine (React Three Fiber + drei)

Room box from published dimensions, round tables (60″, 10 chairs), stage, dance floor, walkway band, decor zones, ghost tables for overflow, object selection outline, orbit/pan/zoom/reset, orthographic 2D mode, evening-light preset. Fallback when WebGL is unavailable: 2D plan (the SVG plan on D5b is a usable reference).

## Needs live backend validation

Venue capacities, dimensions, event-type policies, price, date availability, source URLs + retrieval timestamps, sending inquiries (only after approval).

## Illustrative data in the mockups

- All venue/inspiration photos: Unsplash stock, labeled "Representative".
- Table arrangement, walkway width, 3′7″ chair gap, stage/arch/photo-moment placement: illustrative, not the venue floor plan.
- Budget ranges, "Sofía", the inquiry text and "Ana": placeholder content.
- Verified facts used (checked Oct 23, 2026): The Store House 66′×57′, 4,600 sq ft, 14′3″ ceiling, banquet 100, max 150 / theater 112; Gallery 308 banquet 250, max 430, 3,920 sq ft; Firehouse banquet 80, reception 120, 1,188 sq ft (fortmason.org). The Green Room seated 160–180 and a youth-event restriction that names quinceañeras in one section of sfwarmemorial.org/the-green-room (other sections word it differently, so confirm with the venue).
