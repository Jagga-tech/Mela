"use client";
import { useMemo } from "react";
import type { Recommendation, Vendor, VendorCategory } from "../contracts";
import { rankCategory, shortlist } from "../domain/match";
import { useMela } from "./MelaProvider";

export type CategoryView = { recs: Recommendation[]; list: ReturnType<typeof shortlist> };

/** Recommendations are computed from source facts with the shared deterministic rules, for live and demo data alike. */
export function useRecommendations() {
  const { state } = useMela();
  return useMemo(() => {
    const snap = state.research;
    const brief = state.brief;
    const vendorsById = new Map<string, Vendor>((snap?.vendors ?? []).map((v) => [v.id, v]));
    const view = (category: VendorCategory): CategoryView => {
      if (!snap || !brief) return { recs: [], list: { top: [], more: [], excluded: [], unchecked: [] } };
      const recs = rankCategory(brief, snap.vendors.filter((v) => v.category === category), snap.facts);
      return { recs, list: shortlist(recs, snap.facts) };
    };
    const venue = view("venue");
    const catering = view("catering");
    const recById = new Map([...venue.recs, ...catering.recs].map((r) => [r.vendorId, r]));
    return { venue, catering, vendorsById, recById };
  }, [state.research, state.brief]);
}
