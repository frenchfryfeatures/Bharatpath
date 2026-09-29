import {
  createApi,
  fetchBaseQuery,
} from "@reduxjs/toolkit/query/react";

import { getStoredToken } from "@/lib/auth/token";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8099/api/v1";

function serializeParams(params: Record<string, unknown>) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      continue;
    }

    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      searchParams.append(key, String(item));
    }
  }

  return searchParams.toString();
}

const rawBaseQuery = fetchBaseQuery({
  baseUrl: API_URL,

  paramsSerializer: serializeParams,

  credentials: "include",

  prepareHeaders: (headers) => {
    headers.set(
      "Accept",
      "application/json",
    );

    /*
     * The signed-in user's token, minted at login and kept in local
     * storage, authenticates every direct backend call. Falls back to the
     * local-dev NEXT_PUBLIC_API_BEARER_TOKEN when no one is signed in.
     */
    const bearerToken =
      getStoredToken() ?? process.env.NEXT_PUBLIC_API_BEARER_TOKEN;

    if (bearerToken) {
      headers.set(
        "Authorization",
        `Bearer ${bearerToken}`,
      );
    }

    return headers;
  },
});

export const baseApi = createApi({
  reducerPath: "api",

  baseQuery: rawBaseQuery,

  tagTypes: [
    "Auth",
    "Admin",
    "College",
    "Student",
    "Analytics",
    "Billing",
    "Job",
    "Candidate",
    "Application",
    "Team",
    "Kyb",
  ],

  endpoints: () => ({}),
});
