/**
 * Off-ramp / settlement seam.
 *
 * A QRIS code is settled in IDR by an Indonesian PSP (bank / e-wallet). The
 * on-chain BUSD payment must land at an address that the PSP controls so it can
 * convert to IDR and credit the merchant. We model that as an `OfframpProvider`
 * with a default local stand-in for the demo. Production swaps in a real PSP
 * (e.g. TransFi, which supports BUSD collection + QRIS/GoPay/DANA payout in IDR).
 */

import type { QrisData } from "./qris";

export interface OfframpProvider {
  readonly name: string;
  /** Resolve the on-chain settlement address that should receive the BUSD. */
  resolveSettlementAddress(qris: QrisData): Promise<`0x${string}`>;
}

/** Demo stand-in: a fixed local address (e.g. a Hardhat test account). */
export class LocalSettlementAddress implements OfframpProvider {
  readonly name = "local-settlement";
  constructor(private readonly address: `0x${string}`) {}
  async resolveSettlementAddress(): Promise<`0x${string}`> {
    return this.address;
  }
}

/**
 * TransFi-shaped off-ramp stub. In production you would call TransFi's payout
 * API to push IDR to the QRIS merchant after the on-chain BUSD settles.
 * This stub documents the seam; wire `apiKey` + the real endpoint to activate.
 */
export class TransFiOfframpStub implements OfframpProvider {
  readonly name = "transfi-offramp";
  constructor(
    private readonly settlementAddress: `0x${string}`,
    private readonly apiKey?: string
  ) {}

  async resolveSettlementAddress(): Promise<`0x${string}`> {
    if (!this.apiKey) {
      // No key: still return the bridge address so the on-chain leg is exercisable.
      return this.settlementAddress;
    }
    // Real flow: POST /v1/payouts { rail: "qris", ... } and use the returned
    // settlement address. Left as a documented integration point.
    return this.settlementAddress;
  }
}
