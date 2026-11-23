"use client";

import { useGetReferenceCitiesQuery } from "@/store/student";

/**
 * Indian city suggestions for a city input (2026-11-23), from the curated
 * catalogue at `GET /reference/cities` -- public, so sign-up can use it.
 * Point an `<input list={id}>` at it. Suggestions only: any town can still
 * be typed.
 */
export function CityDatalist({ id, query }: { id: string; query: string }) {
  const term = query.split(",").pop()?.trim() ?? "";
  const { data } = useGetReferenceCitiesQuery(term, { skip: term.length < 2 });
  return (
    <datalist id={id}>
      {(data ?? []).map((city) => (
        <option key={city.key} value={city.label}>
          {city.state_code}
        </option>
      ))}
    </datalist>
  );
}
