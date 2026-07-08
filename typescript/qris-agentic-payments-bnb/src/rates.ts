/**
 * Fiat → BNB Chain stablecoin conversion.
 *
 * The agent must translate the QRIS amount (IDR) into the on-chain stablecoin
 * amount (18 decimals for all BSC stablecoins) — per BNB Chain ecosystem rules
 * the settlement token is a native BSC stablecoin (BUSD, FDUSD, or $U), not a
 * third-party token. The conversion is behind an interface so the demo can use
 * a static rate while production plugs in a live FX source.
 *
 * Multi-token: the rate source converts IDR → any curated BSC stablecoin, not
 * just BUSD. For demo purposes all BSC stablecoins are ~$1 so the rate is the
 * same; in production the source may fetch token-specific rates.
 */

import type { TokenEntry } from "./tokens";

export interface RateSource {
  /** Convert an IDR amount (integer minor units) to a stablecoin base-unit amount (18 decimals). */
  idrToStablecoin(idrAmount: bigint, token: TokenEntry): Promise<bigint>;
}

const STABLECOIN_UNIT = 1_000_000_000_000_000_000n; // 18 decimals

/** Fixed-rate converter for demos/tests (no network, deterministic). */
export class StaticRateSource implements RateSource {
  /** Stablecoin per 1 IDR. Demo default 1 stablecoin ≈ 16,000 IDR. */
  constructor(private readonly stablePerIdr: number) {}

  async idrToStablecoin(
    idrAmount: bigint,
    _token: TokenEntry
  ): Promise<bigint> {
    const amt = Number(idrAmount) * this.stablePerIdr * Number(STABLECOIN_UNIT);
    return BigInt(Math.round(amt));
  }
}

/** Live FX via the public CoinGecko API (no key). Falls back on network error. */
export class CoinGeckoRateSource implements RateSource {
  private coinId = new Map<string, string>([
    ["busd", "binance-usd"],
    ["fdusd", "first-digital-usd"],
    ["u", "u-token"],
  ]);

  async idrToStablecoin(idrAmount: bigint, token: TokenEntry): Promise<bigint> {
    const coinId = this.coinId.get(token.symbol) ?? "binance-usd";
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=idr`
    );
    if (!res.ok) throw new Error(`CoinGecko FX request failed: ${res.status}`);
    const json = (await res.json()) as Record<string, { idr?: number }>;
    const rate = json[coinId]?.idr;
    if (!rate || rate <= 0) throw new Error("CoinGecko returned no IDR rate");
    const amt = (Number(idrAmount) / rate) * Number(STABLECOIN_UNIT);
    return BigInt(Math.round(amt));
  }
}

export function createRateSource(mode: string | undefined): RateSource {
  if (mode === "coingecko") return new CoinGeckoRateSource();
  // Default demo rate: 1 stablecoin ≈ 16,000 IDR.
  return new StaticRateSource(1 / 16000);
}
