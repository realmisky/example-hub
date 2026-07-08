# QRIS Agentic Payments on BNB Chain

A **Web2.5 agentic payments** cookbook: an autonomous agent that parses a QRIS
(Quick Response Code Indonesian Standard) payment code, converts the IDR amount
to BUSD (18-decimal BNB Chain native stablecoin), and settles on BNB Chain via a
direct ERC20 transfer or the x402/MPP machine-payment protocol (`@bnb-chain/mpp`).

This bridges Indonesia's national QR standard with BNB's agentic-payments stack —
the same corridor Bitget Wallet and TransFi already operate — and is the first
example in the hub to demonstrate the x402 / MPP `402 Payment Required` flow.

Per BNB Chain ecosystem rules, settlement uses **BUSD**
(`0xe9e7CEA3DedcA5984780Bafc599bE2b0Fa6fC12`, 18 decimals) — a native BSC
stablecoin, not a third-party token.

## Getting Started

### Prerequisites

- **Node.js** v18+ (tested on v22)
- **npm**
- No wallet, RPC, or funds needed for the demo or tests — they run on an
  in-process Hardhat network.
- For real BSC settlement: a funded wallet (`PRIVATE_KEY` in `.env`) and a BSC
  RPC endpoint.

### Installation

1. **Install dependencies**:

   ```bash
   cd typescript/qris-agentic-payments-bnb
   npm install
   ```

2. **Environment setup**:

   ```bash
   cp .env.example .env
   ```

   Edit `.env` only if you plan to run against real BSC. The demo and tests need
   no credentials.

   ```env
   # Agent wallet (payer). Leave empty for the in-process Hardhat demo.
   PRIVATE_KEY=

   # BNB Chain RPC (optional; defaults to public endpoints).
   BSC_TESTNET_RPC=https://data-seed-prebsc-1-s1.bnbchain.org:8545
   BSC_RPC=https://bsc-dataseed.bnbchain.org

   # Settlement address that receives BUSD on-chain. In production this is the
   # PSP / off-ramp bridge (e.g. TransFi) that converts BUSD -> IDR.
   SETTLEMENT_ADDRESS=

   # Live FX source. Leave empty for the static demo rate (1 BUSD = 16000 IDR)
   # or set to "coingecko" to fetch live BUSD/IDR.
   RATE_SOURCE=

   # x402 / MPP protected URL. When set, the agent can pay via a 402 challenge
   # credential instead of a plain transfer.
   MPP_PROTECTED_URL=
   ```

### Running the Project

**Demo (zero setup)**:

```bash
npx hardhat run scripts/run-agent.ts
# → builds a dynamic QRIS, parses it, converts 16000 IDR → 1.0 BUSD, pays on-chain
```

**Test suite** (7 tests, ~3s):

```bash
npx hardhat test
```

Expected output:

```
  QRIS parser
    ✔ validates CRC16-CCITT correctly
    ✔ detects a tampered CRC
    ✔ rejects a static code with no amount

  IDR -> BUSD conversion
    ✔ converts using a static rate (1 BUSD = 16000 IDR)

  QrisPayAgent end-to-end (local network)
    ✔ parses, converts, and pays BUSD on-chain

  x402 / MPP end-to-end (local SDK loop)
    ✔ buyer pays a 402 challenge and server settles

  payViaMpp (buyer wrapper)
    ✔ probes 402, builds credential, retries, settles

  7 passing
```

## Architecture (5-layer Web2.5 model)

```
[Layer 1] Intent capture (Web2 surface)
   QRIS scan · REST webhook · chat cmd
        │  raw instruction ("pay 16000 IDR to WARUNG PAK DANU")
        ▼
[Layer 2] Translation / orchestration (the agent core)
   parse → validate → FX convert → resolve counterparty → build tx
        │  IDR 16000  ──rate──▶  BUSD 1.0  ──▶  recipient addr
        ▼
[Layer 3] Settlement (Web3)
   direct ERC20 transfer  OR  x402/MPP 402-challenge → credential → retry
        │  on-chain BUSD moves; tx hash is the proof
        ▼
[Layer 4] Reconciliation / off-ramp (Web2.5)
   PSP converts BUSD→IDR and credits merchant; or API returns Payment-Receipt
        │
        ▼
[Layer 5] Reporting (Web2 surface)
   200 OK · receipt · balance update · audit log
```

Concrete file mapping:

```
src/qris.ts          parse + CRC16-CCITT validate (EMVCo TLV, pure TS, no deps)
src/rates.ts         IDR → BUSD (StaticRateSource | CoinGeckoRateSource)
src/offramp.ts       resolve settlement address (LocalSettlementAddress | TransFi stub)
src/payment.ts       BnbPaymentExecutor (ethers local | viem + x402/MPP)
src/agent.ts         QrisPayAgent orchestrator (plan → execute)
src/charge-server.ts minimal 402 server for the x402/MPP loop demo
scripts/run-agent.ts self-contained demo
contracts/MockBUSD.sol  18-decimal BUSD stand-in (matches real BSC BUSD)
test/*.test.ts       7 passing tests
```

## Usage

```ts
import { buildQris, parsePaymentQris } from "./src/qris";
import { QrisPayAgent } from "./src/agent";
import { BnbPaymentExecutor } from "./src/payment";
import { LocalSettlementAddress } from "./src/offramp";

// 1. Ingest a scanned code (string from your QR reader).
const code = buildQris({
  "00": "01",
  "01": "12",
  "26": "...",
  "52": "5812",
  "53": "360",
  "54": "16000",
  "58": "ID",
  "59": "WARUNG PAK DANU",
  "60": "JAKARTA",
});

// 2. Wire the executor (local demo uses an ethers signer; real BSC uses a key).
const executor = new BnbPaymentExecutor({
  rpcUrl: "",
  chainId: 31337,
  busdAddress,
});
executor.attachEthersSigner(payerSigner);

// 3. Plan (dry-run: parse + convert, no broadcast) then execute.
const agent = new QrisPayAgent({
  payment: executor,
  offramp: new LocalSettlementAddress(merchantAddress),
});
const plan = await agent.plan(code); // { idrAmount, busdAmount, settlementAddress, crcValid }
if (!plan.crcValid) throw new Error("tampered QRIS");
const result = await agent.execute(plan); // { txHash, recipient, amount }
```

### x402 / MPP mode

Set `MPP_PROTECTED_URL` to a running `@bnb-chain/mpp` charge-server. The agent
will fetch the `402` challenge, build a BUSD `authorization` credential via the
verified `ClientMppx` flow, then retry so the server settles. See
https://docs.bnbchain.org/developer-kit/mpp-sdk/.

## Going to production

| Demo piece               | Production swap                                                            |
| ------------------------ | -------------------------------------------------------------------------- |
| `MockBUSD`               | Real BSC BUSD `0xe9e7CEA3DedcA5984780Bafc599bE2b0Fa6fC12` (18 decimals)    |
| `StaticRateSource`       | `CoinGeckoRateSource` (or your oracle / PSP quote)                         |
| `LocalSettlementAddress` | `TransFiOfframpStub` → PSP that converts BUSD→IDR and credits the merchant |
| ethers local signer      | `PRIVATE_KEY` + BSC RPC (viem http transport)                              |

QRIS limits (Bank Indonesia): 500 USD/tx, 1,500 USD/day, 10,000 USD/month.

## Security Notes

- CRC16 validated **before** any conversion/payment — tampered codes are rejected.
- Only IDR (`360`) dynamic QRIS (with amount tag `54`) are payable.
- On-chain leg is checks-effects: the ERC20 transfer is the only state change.
- PSP seam is explicit — never hard-code a settlement address you don't control.
- The agent is a hot wallet. Prefer scoped keys, spending caps (`maxAmount` in
  MPP), and a separate settlement address per PSP.

## License

GPL-3.0 (matches example-hub).
