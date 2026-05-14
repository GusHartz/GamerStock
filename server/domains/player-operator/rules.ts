// ─── Player Operator — Action Center Rules ────────────────────────────────────
// Deterministic, rule-based recommendation engine.
// No ML / AI. Each rule inspects the snapshot, mission, and moments state and
// emits zero or more recommended actions.
// ─────────────────────────────────────────────────────────────────────────────
import type { OperatorSnapshot, OperatorAction } from "./types";
import type { PlayerMission, PlayerMoment } from "@shared/schema";

export interface RuleContext {
  snapshot: OperatorSnapshot;
  activeMission: PlayerMission | null;
  activeMoments: PlayerMoment[];
  draftMoments: PlayerMoment[];
  soldOutMoments: PlayerMoment[];
}

type Rule = (ctx: RuleContext) => OperatorAction | null;

const rules: Rule[] = [
  // Rule 1: conversion dropped → send a message to holders
  ({ snapshot }) => {
    if (Number(snapshot.conversionDelta) < -0.5) {
      return {
        actionId: "rule_conversion_drop",
        type: "message",
        title: "Engage your holders — conversion dipped",
        reason: `Conversion rate fell by ${Math.abs(snapshot.conversionDelta).toFixed(1)}% recently.`,
        expectedImpact: "Re-engaging holders can recover 5–10% conversion rate",
        priority: "high",
      };
    }
    return null;
  },

  // Rule 2: activity up but no active mission → create a mission
  ({ snapshot, activeMission }) => {
    if (Number(snapshot.volumeDelta) > 5 && !activeMission) {
      return {
        actionId: "rule_volume_spike_no_mission",
        type: "mission",
        title: "Capitalise on the traffic spike — launch a mission",
        reason: `Volume is up ${snapshot.volumeDelta.toFixed(1)}% and there is no active mission.`,
        expectedImpact: "Missions during volume spikes drive 8–12% holder growth",
        priority: "high",
      };
    }
    return null;
  },

  // Rule 3: high volume + no active moment → suggest creating one
  ({ snapshot, activeMoments }) => {
    if (Number(snapshot.volumeDelta) > 10 && activeMoments.length === 0) {
      return {
        actionId: "rule_volume_create_moment",
        type: "moment",
        title: "Create a limited moment while volume is high",
        reason: `Volume increased ${snapshot.volumeDelta.toFixed(1)}% — perfect timing for a moment drop.`,
        expectedImpact: "Moment drops during volume spikes convert 3× better",
        priority: "medium",
      };
    }
    return null;
  },

  // Rule 4: holder delta positive but small → nudge with a mission
  ({ snapshot }) => {
    if (snapshot.holdersDelta > 0 && snapshot.holdersDelta < 5) {
      return {
        actionId: "rule_slow_holder_growth",
        type: "mission",
        title: "Accelerate holder growth with a mission",
        reason: "Holder growth is positive but slow — a mission could amplify it.",
        expectedImpact: "Mission-driven growth campaigns add 15–25 holders on average",
        priority: "medium",
      };
    }
    return null;
  },

  // Rule 5: draft moment sitting idle → suggest activating it
  ({ draftMoments }) => {
    if (draftMoments.length > 0) {
      const oldest = draftMoments[draftMoments.length - 1];
      return {
        actionId: "rule_draft_moment_idle",
        type: "moment",
        title: `Activate your draft moment "${oldest.title}"`,
        reason: "You have a moment in draft — activate it to start generating revenue.",
        expectedImpact: "Active moments convert fans who are already engaged",
        priority: "medium",
      };
    }
    return null;
  },

  // Rule 6: sold-out moment + active trading → suggest relaunch
  ({ soldOutMoments, snapshot }) => {
    if (soldOutMoments.length > 0 && Number(snapshot.volumeDelta) > 3) {
      const latest = soldOutMoments[0];
      return {
        actionId: "rule_sold_out_relaunch",
        type: "moment",
        title: `Relaunch "${latest.title}" — it sold out`,
        reason: "A moment sold out while trading volume is still elevated. Relaunch with fresh supply.",
        expectedImpact: "Relaunched moments with active demand sell 40% faster",
        priority: "high",
      };
    }
    return null;
  },
];

export function evaluateActionCenterRules(ctx: RuleContext): OperatorAction[] {
  const results: OperatorAction[] = [];
  for (const rule of rules) {
    const action = rule(ctx);
    if (action) results.push(action);
  }
  // Deduplicate by actionId (rules may overlap in edge cases)
  const seen = new Set<string>();
  return results.filter((a) => {
    if (seen.has(a.actionId)) return false;
    seen.add(a.actionId);
    return true;
  });
}
