/**
 * QrisPayAgent — orchestrates the full flow:
 *
 *   scan/ingest QRIS  ->  parse + validate CRC  ->  convert IDR->BUSD
 *   ->  resolve settlement address (PSP seam)  ->  pay on BNB Chain (direct / MPP)
 *
 * It is intentionally dry-run safe: `plan()` computes everything and prints the
 * intended transaction WITHOUT broadcasting, so a builder can verify the parse
 * before spending gas. `execute()` performs the on-chain leg.
 */

import { parsePaymentQris, type QrisData } from "./qris";
import { createRateSource, type RateSource } from "./rates";
import { LocalSettlementAddress, type OfframpProvider } from "./offramp";
import { BnbPaymentExecutor } from "./payment";

export interface AgentDeps {
  payment: BnbPaymentExecutor;
  rateSource?: RateSource;
  offramp?: OfframpProvider;
  /** When set, route the payment through an x402/MPP 402-protected URL. */
  mppProtectedUrl?: string;
}

export interface PaymentPlan {
  qris: QrisData;
  idrAmount: bigint;
  busdAmount: bigint;
  settlementAddress: `0x${string}`;
  recipient: string;
  mode: "direct" | "mpp";
  /** Convenience mirror of qris.crcValid for dry-run checks. */
  crcValid: boolean;
}

export class QrisPayAgent {
  constructor(private readonly deps: AgentDeps) {}

  /** Parse + validate + compute the payment plan without broadcasting. */
  async plan(qrisPayload: string): Promise<PaymentPlan> {
    const qris = parsePaymentQris(qrisPayload);
    const idrAmount = BigInt(qris.amount!.replace(".", ""));
    const rateSource = this.deps.rateSource ?? createRateSource(undefined);
    const busdAmount = await rateSource.idrToBusd(idrAmount);

    const offramp =
      this.deps.offramp ??
      new LocalSettlementAddress("0x0000000000000000000000000000000000000000");
    const settlementAddress = await offramp.resolveSettlementAddress(qris);

    return {
      qris,
      idrAmount,
      busdAmount,
      settlementAddress,
      recipient: qris.merchantName ?? qris.merchantId ?? "unknown",
      mode: this.deps.mppProtectedUrl ? "mpp" : "direct",
      crcValid: qris.crcValid,
    };
  }

  /** Execute the on-chain payment described by the plan. */
  async execute(plan: PaymentPlan) {
    if (plan.mode === "mpp" && this.deps.mppProtectedUrl) {
      return this.deps.payment.payViaMpp(
        this.deps.mppProtectedUrl,
        plan.settlementAddress,
        plan.busdAmount
      );
    }
    return this.deps.payment.payBusd(plan.settlementAddress, plan.busdAmount);
  }
}
