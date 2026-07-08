/**
 * IDR -> BUSD conversion.
 *
 * The agent must translate the QRIS amount (IDR) into the on-chain BNB Chain
 * stablecoin amount (BUSD, 18 decimals) — per BNB Chain ecosystem rules the
 * settlement token is a native BSC stablecoin, not a third-party token. We keep
 * the conversion behind an interface so the demo can use a static rate, while
 * production plugs in a live FX source.
 */

export interface RateSource {
  /** Convert an IDR amount (integer minor units) to a BUSD base-unit amount (18 decimals). */
  idrToBusd(idrAmount: bigint): Promise<bigint>;
}

const BUSD_UNIT = 1_000_000_000_000_000_000n; // 18 decimals

/** Fixed-rate converter for demos/tests (no network, deterministic). */
export class StaticRateSource implements RateSource {
  /** BUSD per 1 IDR. Demo default 1 BUSD ≈ 16,000 IDR. */
  constructor(private readonly busdPerIdr: number) {}

  async idrToBusd(idrAmount: bigint): Promise<bigint> {
    const busd = Number(idrAmount) * this.busdPerIdr * Number(BUSD_UNIT);
    return BigInt(Math.round(busd));
  }
}

/** Live FX via the public CoinGecko API (no key). Falls back on network error. */
export class CoinGeckoRateSource implements RateSource {
  async idrToBusd(idrAmount: bigint): Promise<bigint> {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=binance-usd&vs_currencies=idr"
    );
    if (!res.ok) throw new Error(`CoinGecko FX request failed: ${res.status}`);
    const json = (await res.json()) as { "binance-usd"?: { idr?: number } };
    const busdIdr = json["binance-usd"]?.idr;
    if (!busdIdr || busdIdr <= 0)
      throw new Error("CoinGecko returned no IDR rate");
    const busd = (Number(idrAmount) / busdIdr) * Number(BUSD_UNIT);
    return BigInt(Math.round(busd));
  }
}

export function createRateSource(mode: string | undefined): RateSource {
  if (mode === "coingecko") return new CoinGeckoRateSource();
  // Default demo rate: 1 BUSD ≈ 16,000 IDR.
  return new StaticRateSource(1 / 16000);
}
