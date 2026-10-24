// DEMO FIXTURE — every vendor here is fictional. Names, numbers and URLs are invented
// (.example domains, 555 numbers) so nothing can be mistaken for a real business.
// Scenario source: Mela_CalHacks_Optimized_Build_Plan.docx §1 (Oakland baby shower, 75–100 guests,
// Jan 17 2027, $2,000 venue cap, Mexican catering with meat + vegetarian) and §7 ($1,250 quote vs $1,400 invoice).
import type { Policy, ReviewEvidence, ResearchSource, SourceFact, Vendor } from "../contracts";

export type DemoSourcePlan = Omit<ResearchSource, "status" | "attempt" | "fetchedAt" | "latencyMs"> & {
  final: ResearchSource["status"];
  /** ms after start when the source settles; > SLOW_AFTER_MS shows "slow" first */
  settlesAt: number;
};

export const RECORDED_AT = "2026-10-24T18:40:00.000Z";
const at = RECORDED_AT;

export const scenario = {
  id: "oakland-baby-shower",
  title: "Oakland baby shower",
  exampleText:
    "I'm planning a baby shower in Oakland for 75 to 100 guests on January 17, 2027. My budget is $2,000. The venue must have bathrooms, climate control, and allow outside catering and alcohol. I'd prefer something modern-feeling, and indoor or outdoor is fine. Catering must be Mexican with both meat and vegetarian options.",
  eventCode: "EVT-0117",
  manager: { kind: "human" as const, id: "usr_rosa", name: "Rosa Medina", role: "ap_manager" as const },
  rolePlay: {
    phone: "+1 (510) 555-0142",
    label: "Teammate role-play line — a consenting teammate plays a fictional venue. Not the venue's real number.",
  },
};

const v = (id: string, name: string, category: Vendor["category"], area: string, palette: [string, string], phone?: string): Vendor => ({
  id, name, category, area, fictional: true, palette, website: `https://${id.slice(2)}.example`,
  contact: phone ? { phone, sourceLabel: "Official contact page (fixture)", sourceUrl: `https://${id.slice(2)}.example/contact`, sourceFactId: `f-${id}-phone` } : undefined,
});

export const vendors: Vendor[] = [
  v("v-lakeview-loft", "Lakeview Loft", "venue", "Oakland · Lake Merritt", ["#c9b8e8", "#f2d9c4"], "+1 (510) 555-0101"),
  v("v-fruitvale-hall", "Fruitvale Garden Hall", "venue", "Oakland · Fruitvale", ["#bcd3b0", "#efe2c9"], "+1 (510) 555-0102"),
  v("v-temescal-studio", "Temescal Studio", "venue", "Oakland · Temescal", ["#d9c6b3", "#e9e3f2"], "+1 (510) 555-0103"),
  v("v-jacklondon-roof", "Jack London Rooftop", "venue", "Oakland · Jack London Sq.", ["#b7c7d9", "#f3dccf"], "+1 (510) 555-0104"),
  v("v-dimond-room", "Dimond Community Room", "venue", "Oakland · Dimond", ["#d6d0c4", "#ece6da"]),
  v("c-cocina-abuela", "Cocina Abuela Catering", "catering", "Delivers in Oakland", ["#f0c9a8", "#f6e7c8"], "+1 (510) 555-0201"),
  v("c-masa-fuego", "Masa y Fuego", "catering", "Berkeley · delivers to Oakland", ["#e6b8a2", "#f2e0d0"], "+1 (510) 555-0202"),
  v("c-taquiza-lupita", "Taquiza Lupita", "catering", "Oakland · Fruitvale", ["#efd39c", "#f4e9d6"], "+1 (510) 555-0203"),
  v("c-brasa-grill", "Brasa Grill", "catering", "Oakland · Uptown", ["#d4a99a", "#efe1d8"], "+1 (510) 555-0204"),
];

type F = Omit<SourceFact, "id" | "vendorId" | "url" | "retrievedAt" | "sourceId"> & { id?: string };
const facts = (vendorId: string, page: string, list: F[]): SourceFact[] =>
  list.map((f, i) => ({ id: f.id ?? `f-${vendorId}-${i}`, vendorId, url: `https://${vendorId.slice(2)}.example/${page}`, retrievedAt: at, sourceId: `s-${vendorId}`, ...f }));
const unknown = (field: SourceFact["field"]): F => ({ field, state: "unknown", unknownReason: "not_on_page" });

export const sourceFacts: SourceFact[] = [
  ...facts("v-lakeview-loft", "rentals", [
    { field: "capacity", state: "verified", value: 120, quote: "Seated capacity: 120 guests" },
    { field: "rental_fee", state: "verified", value: 110000, quote: "Saturday rental (5 hours): $1,100", qualifier: "exact" },
    { field: "cleaning_fee", state: "verified", value: 15000, quote: "Cleaning fee: $150" },
    { field: "bathrooms", state: "verified", value: true, quote: "Two accessible restrooms on the event floor" },
    { field: "climate_control", state: "verified", value: true, quote: "Central heating and air conditioning" },
    { field: "outside_catering", state: "verified", value: true, quote: "You're welcome to bring a licensed caterer of your choice" },
    { field: "alcohol", state: "verified", value: true, quote: "Beer and wine permitted with a licensed bartender" },
    { field: "style", state: "verified", value: "modern loft", quote: "A light-filled modern loft above the lake" },
    { id: "f-v-lakeview-loft-phone", field: "contact_phone", state: "verified", value: "+1 (510) 555-0101", quote: "Events: (510) 555-0101" },
  ]),
  ...facts("v-fruitvale-hall", "events", [
    { field: "capacity", state: "verified", value: 100, quote: "Hall holds up to 100 guests" },
    { field: "rental_fee", state: "verified", value: 145000, quote: "Weekend rate: $1,450 (6 hours)", qualifier: "exact" },
    unknown("cleaning_fee"),
    { field: "bathrooms", state: "verified", value: true, quote: "Restrooms adjoin the hall" },
    unknown("climate_control"),
    { field: "outside_catering", state: "verified", value: true, quote: "Outside caterers welcome" },
    { field: "alcohol", state: "verified", value: true, quote: "Alcohol allowed with event insurance" },
    { field: "style", state: "verified", value: "garden hall", quote: "A garden hall with string lights" },
  ]),
  ...facts("v-temescal-studio", "book", [
    { field: "capacity", state: "verified", value: 90, quote: "Maximum occupancy 90" },
    { field: "rental_fee", state: "verified", value: 95000, quote: "Half-day booking $950", qualifier: "exact" },
    { field: "bathrooms", state: "verified", value: true, quote: "Restroom on site" },
    { field: "climate_control", state: "verified", value: true, quote: "Fully climate controlled" },
    { field: "outside_catering", state: "verified", value: true, quote: "Bring any caterer" },
    { field: "alcohol", state: "verified", value: true, quote: "BYO beer and wine" },
    { field: "style", state: "verified", value: "modern studio", quote: "Minimal modern studio space" },
  ]),
  ...facts("v-jacklondon-roof", "private-events", [
    { field: "capacity", state: "verified", value: 150, quote: "Receptions up to 150" },
    { field: "rental_fee", state: "verified", value: 180000, quote: "Room fee from $1,800", qualifier: "starting_at" },
    { field: "bathrooms", state: "verified", value: true, quote: "Private restrooms" },
    { field: "climate_control", state: "verified", value: true, quote: "Heated, covered rooftop" },
    { field: "outside_catering", state: "verified", value: false, quote: "All food and beverage is provided by our in-house kitchen" },
    { field: "alcohol", state: "verified", value: true, quote: "Full bar service" },
    { field: "style", state: "verified", value: "modern rooftop", quote: "Modern rooftop with bay views" },
  ]),
  ...facts("c-cocina-abuela", "menu", [
    { field: "cuisine", state: "verified", value: "Mexican", quote: "Home-style Mexican catering" },
    { field: "meat_options", state: "verified", value: true, quote: "Carnitas, pollo asado, carne asada" },
    { field: "vegetarian_options", state: "verified", value: true, quote: "Vegetarian: rajas con crema, calabacitas, frijoles de la olla" },
    { field: "price_per_guest", state: "verified", value: 2800, quote: "Taquiza packages: $28 per guest", qualifier: "exact" },
    { field: "service_area", state: "verified", value: "Oakland, Berkeley, Alameda", quote: "We deliver in Oakland, Berkeley and Alameda" },
  ]),
  ...facts("c-masa-fuego", "catering", [
    { field: "cuisine", state: "verified", value: "Mexican", quote: "Oaxacan-inspired Mexican catering" },
    { field: "meat_options", state: "verified", value: true, quote: "Barbacoa and chicken mole" },
    { field: "vegetarian_options", state: "verified", value: true, quote: "Vegetarian and vegan menus available" },
    { field: "price_per_guest", state: "verified", value: 3500, quote: "Packages from about $35 per person", qualifier: "starting_at" },
  ]),
  ...facts("c-taquiza-lupita", "", [
    { field: "cuisine", state: "verified", value: "Mexican", quote: "Taquiza for parties" },
    { field: "meat_options", state: "verified", value: true, quote: "Al pastor, asada, chicken" },
    unknown("vegetarian_options"),
    { field: "price_per_guest", state: "verified", value: 2400, quote: "$24 per person, 50 person minimum", qualifier: "exact" },
  ]),
  ...facts("c-brasa-grill", "catering", [
    { field: "cuisine", state: "verified", value: "Mexican grill", quote: "Mexican grill catering" },
    { field: "meat_options", state: "verified", value: true, quote: "Mesquite-grilled meats" },
    { field: "vegetarian_options", state: "verified", value: false, quote: "Our menu is all about the meat — no vegetarian mains" },
    { field: "price_per_guest", state: "verified", value: 2600, quote: "$26 per guest", qualifier: "exact" },
  ]),
];

const review = (id: string, vendorId: string, excerpt: string, rating: number, sample: string): ReviewEvidence => ({
  id, vendorId, kind: "review", provider: "fixture", url: `https://reviews.example/${vendorId}`, retrievedAt: at, postedAt: "2026-08-02",
  excerpt, rating, attribution: "Public review (fixture) · reviewer handle not stored", sampleContext: sample,
});

export const reviews: ReviewEvidence[] = [
  review("r1", "v-lakeview-loft", "Bright, easy to decorate, and the staff were relaxed about our caterer.", 5, "1 of 3 sampled reviews · fixture"),
  review("r2", "v-lakeview-loft", "Parking was tight on a Saturday.", 3, "1 of 3 sampled reviews · fixture"),
  review("r3", "v-fruitvale-hall", "Lovely garden, but it got warm inside in the afternoon.", 4, "1 of 2 sampled reviews · fixture"),
  review("r4", "c-cocina-abuela", "The vegetarian rajas went first. Generous portions.", 5, "1 of 4 sampled reviews · fixture"),
  review("r5", "c-masa-fuego", "Amazing mole. Quote came in a bit higher than the website range.", 4, "1 of 3 sampled reviews · fixture"),
  review("r6", "c-taquiza-lupita", "Great taquiza, fast setup.", 5, "1 of 2 sampled reviews · fixture"),
];

const src = (id: string, label: string, url: string, provider: ResearchSource["provider"], sourceType: ResearchSource["sourceType"], final: ResearchSource["status"], settlesAt: number, vendorId?: string, error?: string): DemoSourcePlan =>
  ({ id, label, url, provider, sourceType, final, settlesAt, vendorId, error });

export const SLOW_AFTER_MS = 2600;
export const sourcePlan: DemoSourcePlan[] = [
  src("s-search-venues", "Search · Oakland event venues for 100 guests", "serp: oakland event venue 100 guests", "fixture", "directory_listing", "found", 900),
  src("s-v-lakeview-loft", "lakeview-loft.example/rentals", "https://lakeview-loft.example/rentals", "fixture", "venue_site", "found", 1700, "v-lakeview-loft"),
  src("s-v-fruitvale-hall", "fruitvale-hall.example/events", "https://fruitvale-hall.example/events", "fixture", "venue_site", "partial", 3400, "v-fruitvale-hall", "Page had no climate-control or cleaning-fee info"),
  src("s-v-temescal-studio", "temescal-studio.example/book", "https://temescal-studio.example/book", "fixture", "venue_site", "found", 2100, "v-temescal-studio"),
  src("s-v-jacklondon-roof", "jacklondon-roof.example/private-events", "https://jacklondon-roof.example/private-events", "fixture", "venue_site", "found", 2500, "v-jacklondon-roof"),
  src("s-v-dimond-room", "dimond-room.example", "https://dimond-room.example", "fixture", "venue_site", "blocked", 4200, "v-dimond-room", "Site blocked automated reading — open it yourself"),
  src("s-search-caterers", "Search · Mexican caterers delivering to Oakland", "serp: mexican catering oakland vegetarian", "fixture", "directory_listing", "found", 1200),
  src("s-c-cocina-abuela", "cocina-abuela.example/menu", "https://cocina-abuela.example/menu", "fixture", "vendor_site", "found", 2000, "c-cocina-abuela"),
  src("s-c-masa-fuego", "masa-fuego.example/catering", "https://masa-fuego.example/catering", "fixture", "vendor_site", "found", 3000, "c-masa-fuego"),
  src("s-c-taquiza-lupita", "taquiza-lupita.example", "https://taquiza-lupita.example", "fixture", "vendor_site", "partial", 2800, "c-taquiza-lupita", "Menu page didn't mention vegetarian dishes"),
  src("s-c-brasa-grill", "brasa-grill.example/catering", "https://brasa-grill.example/catering", "fixture", "vendor_site", "found", 1900, "c-brasa-grill"),
  src("s-search-more", "Search · Oakland caterers, second query", "serp: oaxacan catering east bay", "fixture", "directory_listing", "empty", 3800, undefined, "No usable results"),
  src("s-apify-posts", "Public reviews & posts (Apify actor, recorded)", "apify: compass/crawler-google-places (recorded dataset)", "fixture", "public_posts", "found", 4600),
];

export const callScript = {
  vendorId: "v-lakeview-loft",
  answers: [
    "Yes — January 17th is open right now. I'd need a signed contract to hold it, though.",
    "Yes, outside caterers are fine as long as they're licensed.",
    "Beer and wine are fine with a licensed bartender, and we ask for event insurance.",
    "It's $1,100 for five hours plus a $150 cleaning fee. Setup and breakdown is separate, usually around $150.",
    "Fifty percent deposit when you sign, the rest two weeks before.",
  ],
  verbalPriceCents: 125000,
};

/** Simulated AP record. Built from the chosen venue's published lines; the invoice adds one unquoted line. */
export const finance = {
  quoteId: "Q-201",
  commitmentId: "C-044",
  invoiceId: "INV-3107",
  addedLine: { id: "L3", label: "Setup & breakdown fee", totalCents: 15000 },
  policy: { id: "P-1", version: 1, rule: "Hold any invoice line that is not in the approved quote.", maxAutoCents: 0, maxAutoPct: 0 } satisfies Policy,
};
