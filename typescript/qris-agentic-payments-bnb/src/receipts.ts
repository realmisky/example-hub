/**
 * Receipt log — persistent payment receipts for audit and reconciliation.
 *
 * In the BNBAgent SDK stack, Greenfield provides durable storage for agent
 * memory. This module models the receipt log seam: every settled payment
 * produces a structured receipt that is persisted (locally for the demo, to
 * Greenfield in production) so the merchant, agent operator, and auditor can
 * verify what happened.
 *
 * The receipt captures the full Web2.5 chain: QRIS source → FX conversion →
 * on-chain settlement → PSP off-ramp confirmation. Each receipt gets a
 * deterministic ID (keccak of the tx hash + timestamp) so it can be referenced
 * from ERC-8183 job deliverables.
 */

export interface PaymentReceipt {
  /** Deterministic receipt ID. */
  receiptId: string;
  /** On-chain transaction hash. */
  txHash: `0x${string}`;
  /** Block number where the tx was confirmed. */
  blockNumber?: number;
  /** Timestamp (seconds since epoch). */
  timestamp: number;
  /** Token symbol settled (e.g. "BUSD", "FDUSD", "U"). */
  tokenSymbol: string;
  /** Token contract address. */
  tokenAddress: `0x${string}`;
  /** Amount in token base units (18 decimals for BSC stablecoins). */
  amountBase: bigint;
  /** Human-readable amount (e.g. "1.0"). */
  amountDisplay: string;
  /** Recipient/settlement address. */
  recipient: `0x${string}`;
  /** Original fiat amount (IDR minor units). */
  fiatAmount?: bigint;
  /** Fiat currency code (e.g. "IDR"). */
  fiatCurrency?: string;
  /** FX rate used (1 token = N fiat). */
  fxRate?: number;
  /** Payment mode: direct transfer or x402/MPP. */
  mode: "direct" | "mpp";
  /** MPP Payment-Receipt header (if mode=mpp). */
  mppReceipt?: string;
  /** QRIS merchant name (from the source code). */
  merchantName?: string;
  /** Agent identity ID (ERC-8004 agentId). */
  agentId?: string;
}

export interface ReceiptLog {
  /** Persist a receipt. */
  append(receipt: PaymentReceipt): Promise<void>;
  /** Look up a receipt by ID. */
  get(receiptId: string): Promise<PaymentReceipt | null>;
  /** List all receipts, newest first. */
  list(limit?: number): Promise<PaymentReceipt[]>;
  /** List receipts for a specific agent. */
  listByAgent(agentId: string): Promise<PaymentReceipt[]>;
}

/** In-memory receipt log for the demo/tests. */
export class LocalReceiptLog implements ReceiptLog {
  private readonly receipts: PaymentReceipt[] = [];

  async append(receipt: PaymentReceipt): Promise<void> {
    this.receipts.unshift(receipt);
  }

  async get(receiptId: string): Promise<PaymentReceipt | null> {
    return this.receipts.find((r) => r.receiptId === receiptId) ?? null;
  }

  async list(limit = 50): Promise<PaymentReceipt[]> {
    return this.receipts.slice(0, limit);
  }

  async listByAgent(agentId: string): Promise<PaymentReceipt[]> {
    return this.receipts.filter((r) => r.agentId === agentId);
  }
}

/** Generate a deterministic receipt ID from tx hash + timestamp. */
export function receiptId(txHash: string, timestamp: number): string {
  // Simple hash — production would use keccak256.
  let h = 0;
  const s = txHash + timestamp.toString();
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return "rcpt_" + Math.abs(h).toString(16).padStart(8, "0");
}
