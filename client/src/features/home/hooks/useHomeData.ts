import { useQuery } from "@tanstack/react-query";
import type { HomeApiResponse } from "../types/home";
import { isPredictEnabled } from "@/lib/featureFlags";

/**
 * Safe fallback that satisfies the full HomeApiResponse shape.
 * Used when Predict is disabled or when the endpoint returns an error.
 * All arrays are empty and hero surfaces are null — downstream mappers
 * and components handle this gracefully via their own conditional rendering.
 */
export const SAFE_HOME_FALLBACK: HomeApiResponse = {
  generatedAt:         new Date(0).toISOString(),
  liveMatches:         [],
  trendingPredictions: [],
  upcomingEvents:      [],
  hotPlayers:          null,
  totalLive:           0,
  publicSurfaces: {
    hero:                    null,
    heroMarket:              null,
    featuredEvents:          [],
    livePredictions:         [],
    upcomingEventsEditorial: [],
  },
};

/**
 * Fetches /api/predictions/home and never throws.
 * Any network or HTTP error returns SAFE_HOME_FALLBACK so TanStack Query
 * never transitions to isError = true for this key.
 */
async function fetchHomeDataSafe(): Promise<HomeApiResponse> {
  try {
    const res = await fetch("/api/predictions/home", { credentials: "include" });
    if (!res.ok) return SAFE_HOME_FALLBACK;
    return (await res.json()) as HomeApiResponse;
  } catch {
    return SAFE_HOME_FALLBACK;
  }
}

export function useHomeData() {
  const enabled = isPredictEnabled();

  const query = useQuery<HomeApiResponse>({
    queryKey:        ["/api/predictions/home"],
    queryFn:         fetchHomeDataSafe,
    staleTime:       30_000,
    // Polling is disabled when the feature flag is off
    refetchInterval: enabled ? 60_000 : false,
    // Do not fetch at all when Predict is disabled
    enabled,
    // Show fallback data immediately (no loading flash when disabled)
    placeholderData: SAFE_HOME_FALLBACK,
  });

  // When the flag is off, bypass the query result entirely
  if (!enabled) {
    return {
      data:      SAFE_HOME_FALLBACK,
      isLoading: false,
      isError:   false,
      error:     null,
      refetch:   () => Promise.resolve(),
    } as const;
  }

  // When enabled: always surface valid data and never propagate errors
  // (fetchHomeDataSafe already swallows errors and returns SAFE_HOME_FALLBACK)
  return {
    ...query,
    data:    query.data ?? SAFE_HOME_FALLBACK,
    isError: false,
    error:   null,
  };
}
