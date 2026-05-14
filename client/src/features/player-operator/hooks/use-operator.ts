import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type {
  OverviewResponse,
  OperatorSnapshot,
  OperatorAction,
  OperatorMissionView,
  OperatorCardVisualView,
  OperatorActivityEventView,
  OperatorMomentView,
} from "../../../../../server/domains/player-operator/types";

// Re-export for convenience
export type {
  OverviewResponse,
  OperatorSnapshot,
  OperatorAction,
  OperatorMissionView,
  OperatorCardVisualView,
  OperatorActivityEventView,
  OperatorMomentView,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function operatorFetch<T>(url: string): Promise<T> {
  return fetch(url, { credentials: "include" }).then((res) => {
    if (res.status === 401) throw Object.assign(new Error("Unauthorized"), { status: 401 });
    if (res.status === 403) throw Object.assign(new Error("Forbidden"), { status: 403 });
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return res.json();
  });
}

// ── Queries ───────────────────────────────────────────────────────────────────

export function useOperatorOverview(assetId: number) {
  return useQuery<OverviewResponse>({
    queryKey: ["/api/player-operator", assetId, "overview"],
    queryFn: () => operatorFetch(`/api/player-operator/${assetId}/overview`),
    enabled: assetId > 0,
    staleTime: 10_000,
    retry: false,
  });
}

export function usePerformanceSnapshot(assetId: number, enabled = true) {
  return useQuery<OperatorSnapshot>({
    queryKey: ["/api/player-operator", assetId, "performance-snapshot"],
    queryFn: () => operatorFetch(`/api/player-operator/${assetId}/performance-snapshot`),
    enabled: assetId > 0 && enabled,
    refetchInterval: 15_000,
    staleTime: 10_000,
    retry: false,
  });
}

export function useActionCenter(assetId: number, enabled = true) {
  return useQuery<OperatorAction[]>({
    queryKey: ["/api/player-operator", assetId, "action-center"],
    queryFn: () =>
      operatorFetch<{ actions: OperatorAction[] }>(`/api/player-operator/${assetId}/action-center`)
        .then((d) => d.actions),
    enabled: assetId > 0 && enabled,
    refetchInterval: 30_000,
    staleTime: 20_000,
    retry: false,
  });
}

export function useMission(assetId: number, enabled = true) {
  return useQuery<OperatorMissionView | null>({
    queryKey: ["/api/player-operator", assetId, "mission"],
    queryFn: () => operatorFetch<{ mission: OperatorMissionView | null }>(`/api/player-operator/${assetId}/mission`)
      .then((d) => d.mission),
    enabled: assetId > 0 && enabled,
    staleTime: 30_000,
    retry: false,
  });
}

export function useLiveActivity(assetId: number, enabled = true) {
  return useQuery<OperatorActivityEventView[]>({
    queryKey: ["/api/player-operator", assetId, "live-activity"],
    queryFn: () => operatorFetch<{ events: OperatorActivityEventView[] }>(`/api/player-operator/${assetId}/live-activity`)
      .then((d) => d.events),
    enabled: assetId > 0 && enabled,
    refetchInterval: 10_000,
    staleTime: 8_000,
    retry: false,
  });
}

export function useCardVisual(assetId: number, enabled = true) {
  return useQuery<OperatorCardVisualView | null>({
    queryKey: ["/api/player-operator", assetId, "card-visual"],
    queryFn: () => operatorFetch<{ cardVisual: OperatorCardVisualView | null }>(`/api/player-operator/${assetId}/card-visual`)
      .then((d) => d.cardVisual),
    enabled: assetId > 0 && enabled,
    staleTime: 30_000,
    retry: false,
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useCreateMission(assetId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      type: string;
      title: string;
      description?: string;
      goalValue: number;
      endDate?: string;
    }) => {
      const res = await apiRequest("POST", `/api/player-operator/${assetId}/missions`, input);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/player-operator", assetId, "mission"] });
      qc.invalidateQueries({ queryKey: ["/api/player-operator", assetId, "overview"] });
      qc.invalidateQueries({ queryKey: ["/api/player-operator", assetId, "action-center"] });
    },
  });
}

export function useUpdateMission(assetId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      missionId: number;
      status?: string;
      title?: string;
      description?: string;
      goalValue?: number;
      endDate?: string;
    }) => {
      const { missionId, ...rest } = input;
      const res = await apiRequest("PATCH", `/api/player-operator/${assetId}/missions/${missionId}`, rest);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/player-operator", assetId, "mission"] });
      qc.invalidateQueries({ queryKey: ["/api/player-operator", assetId, "overview"] });
      qc.invalidateQueries({ queryKey: ["/api/player-operator", assetId, "action-center"] });
    },
  });
}

export function useTriggerAction(assetId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (actionId: string | number) => {
      const res = await apiRequest("POST", `/api/player-operator/${assetId}/actions/${actionId}/trigger`, {});
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/player-operator", assetId, "action-center"] });
      qc.invalidateQueries({ queryKey: ["/api/player-operator", assetId, "overview"] });
    },
  });
}

export function useUploadCardImage(assetId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/player-operator/${assetId}/card-image`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Upload failed" }));
        throw new Error(err.message ?? "Upload failed");
      }
      return res.json() as Promise<{ imageUrl: string; cardVisual: OperatorCardVisualView }>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/player-operator", assetId, "card-visual"] });
      qc.invalidateQueries({ queryKey: ["/api/player-operator", assetId, "overview"] });
    },
  });
}

export function useUpdateCardVisual(assetId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      templateId?: string;
      status?: string;
      overlayConfig?: Record<string, unknown>;
      cropConfig?: Record<string, unknown>;
    }) => {
      const res = await apiRequest("PATCH", `/api/player-operator/${assetId}/card-visual`, input);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/player-operator", assetId, "card-visual"] });
      qc.invalidateQueries({ queryKey: ["/api/player-operator", assetId, "overview"] });
    },
  });
}

// ── Moments ───────────────────────────────────────────────────────────────────

export function useMoments(assetId: number, enabled = true) {
  return useQuery<OperatorMomentView[]>({
    queryKey: ["/api/player-operator", assetId, "moments"],
    queryFn: () =>
      operatorFetch<{ moments: OperatorMomentView[] }>(`/api/player-operator/${assetId}/moments`)
        .then((d) => d.moments),
    enabled: assetId > 0 && enabled,
    staleTime: 30_000,
    retry: false,
  });
}

export function useCreateMoment(assetId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      title: string;
      rarity: string;
      price: number;
      supplyTotal: number;
      status?: string;
    }) => {
      const res = await apiRequest("POST", `/api/player-operator/${assetId}/moments`, input);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/player-operator", assetId, "moments"] });
      qc.invalidateQueries({ queryKey: ["/api/player-operator", assetId, "action-center"] });
      qc.invalidateQueries({ queryKey: ["/api/player-operator", assetId, "live-activity"] });
    },
  });
}

export function useUpdateMoment(assetId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      momentId: number;
      title?: string;
      rarity?: string;
      price?: number;
      supplyTotal?: number;
      status?: string;
    }) => {
      const { momentId, ...rest } = input;
      const res = await apiRequest("PATCH", `/api/player-operator/${assetId}/moments/${momentId}`, rest);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/player-operator", assetId, "moments"] });
      qc.invalidateQueries({ queryKey: ["/api/player-operator", assetId, "action-center"] });
      qc.invalidateQueries({ queryKey: ["/api/player-operator", assetId, "live-activity"] });
    },
  });
}

export function useRelaunchMoment(assetId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { momentId: number; price: number; supplyTotal: number }) => {
      const res = await apiRequest(
        "POST",
        `/api/player-operator/${assetId}/moments/${input.momentId}/relaunch`,
        { price: input.price, supplyTotal: input.supplyTotal },
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/player-operator", assetId, "moments"] });
      qc.invalidateQueries({ queryKey: ["/api/player-operator", assetId, "action-center"] });
      qc.invalidateQueries({ queryKey: ["/api/player-operator", assetId, "live-activity"] });
    },
  });
}
