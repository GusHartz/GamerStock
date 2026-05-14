/**
 * Treasury Domain — Event Handlers
 *
 * Handles FeeCaptured events emitted after every trade settlement.
 * Activated in Phase 3 — runs live for all market orders and limit order settlements.
 */

import type { FeeCapturedEvent } from "../domain-events";

export async function handleFeeCaptured(event: FeeCapturedEvent): Promise<void> {
  const { tradeId, feeTotal, platformFee, playerFee, liquidityFee, notional, currency } = event.payload;

  console.log(
    `[Treasury] FeeCaptured — tradeId=${tradeId} currency=${currency} ` +
    `notional=${notional.toFixed(4)} total=${feeTotal.toFixed(6)} ` +
    `platform=${platformFee.toFixed(6)} player=${playerFee.toFixed(6)} liquidity=${liquidityFee.toFixed(6)}`,
  );
}
