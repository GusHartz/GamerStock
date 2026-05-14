import type { HomeApiResponse } from "../types/home";

export async function getHomeData(): Promise<HomeApiResponse> {
  const res = await fetch("/api/predictions/home", { credentials: "include" });
  if (!res.ok) throw new Error(`Failed to load home data: ${res.status}`);
  return res.json();
}
