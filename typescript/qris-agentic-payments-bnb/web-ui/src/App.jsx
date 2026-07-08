import { useState, useCallback, useEffect, useRef } from "react";
import { useWallet } from "./useWallet.jsx";
import { parseQRIS, buildDemoQRIS, crc16CCITT } from "./qris.js";

// Palette: indigo #3D348B + amber #F0A202 on cream #FAF7F2
const RATE_IDR_PER_BUSD = 18000;

const SAMPLE_MERCHANTS = [
  { name: "WARUNG PAK DANU", city: "Jakarta", amountIDR: 18000, emoji: "🍜" },
  { name: "KOPI KENANGAN", city: "Bandung", amountIDR: 25000, emoji: "☕" },
  {
    name: "MIE AYAM PAK BUDI",
    city: "Surabaya",
    amountIDR: 15000,
    emoji: "🍝",
  },
  {
    name: "TOKO ELEKTRONIK MEDAN",
    city: "Medan",
    amountIDR: 150000,
    emoji: "📱",
  },
];

const STEPS = [
  { id: "scan", label: "Scan", icon: "📷" },
  { id: "parse", label: "Parse", icon: "🔍" },
  { id: "fx", label: "Convert", icon: "💱" },
  { id: "identity", label: "Identity", icon: "🆔" },
  { id: "policy", label: "Policy", icon: "🛡️" },
  { id: "settle", label: "Settle", icon: "⛓️" },
  { id: "receipt", label: "Receipt", icon: "🧾" },
];

export default function App() {
  const wallet = useWallet();
  const [step, setStep] = useState(0);
  const [selectedMerchant, setSelectedMerchant] = useState(null);
  const [qrisString, setQrisString] = useState("");
  const [parsedQRIS, setParsedQRIS] = useState(null);
  const [busdAmount, setBusdAmount] = useState(null);
  const [liveRate, setLiveRate] = useState(null);
  const [vaultAddress, setVaultAddress] = useState(
    localStorage.getItem("vaultAddress") || ""
  );
  const [merchantAddress, setMerchantAddress] = useState(
    localStorage.getItem("merchantAddress") || ""
  );
  const [settleResult, setSettleResult] = useState(null);
  const [settling, setSettling] = useState(false);
  const [error, setError] = useState(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const pipelineRef = useRef(null);

  // Fetch live CoinGecko rate on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=binance-usd&vs_currencies=idr"
        );
        const data = await res.json();
        if (data["binance-usd"]?.idr) setLiveRate(data["binance-usd"].idr);
      } catch (_) {}
    })();
  }, []);

  // Save addresses
  useEffect(() => {
    if (vaultAddress) localStorage.setItem("vaultAddress", vaultAddress);
  }, [vaultAddress]);
  useEffect(() => {
    if (merchantAddress)
      localStorage.setItem("merchantAddress", merchantAddress);
  }, [merchantAddress]);

  const selectMerchant = useCallback((merchant) => {
    setSelectedMerchant(merchant);
    const qris = buildDemoQRIS(
      merchant.amountIDR,
      merchant.name.padEnd(25, " ") + "JAKARTA"
    );
    setQrisString(qris);
    setParsedQRIS(null);
    setBusdAmount(null);
    setSettleResult(null);
    setError(null);
    setShowConfetti(false);
    setStep(1);
    // Smooth scroll to pipeline
    setTimeout(
      () =>
        pipelineRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        }),
      200
    );
  }, []);

  const doParse = useCallback(() => {
    if (!qrisString) return;
    const result = parseQRIS(qrisString);
    setParsedQRIS(result);
    if (result.crcValid) setStep(2);
    else setError("CRC validation failed — QRIS is tampered or malformed");
  }, [qrisString]);

  const doFX = useCallback(() => {
    const idrAmount = BigInt(parsedQRIS.tags["54"] || "0");
    const rate = liveRate || RATE_IDR_PER_BUSD;
    const busdWei = (idrAmount * 10n ** 18n) / BigInt(Math.floor(rate));
    const busdWhole = Number(busdWei / 10n ** 18n);
    const busdFraction = Number(busdWei % 10n ** 18n) / 1e18;
    setBusdAmount({
      wei: busdWei.toString(),
      display: (busdWhole + busdFraction).toFixed(6),
    });
    setStep(3);
  }, [parsedQRIS, liveRate]);

  const doIdentity = useCallback(() => setStep(4), []);
  const doPolicy = useCallback(() => setStep(5), []);

  const doSettle = useCallback(async () => {
    if (!wallet.signer) {
      setError("Connect your wallet first");
      return;
    }
    if (!vaultAddress) {
      setError("Enter the QrisPaymentVault contract address");
      return;
    }
    setSettling(true);
    setError(null);
    try {
      const { ethers } = await import("ethers");
      const ERC20_ABI = [
        "function balanceOf(address) view returns (uint256)",
        "function approve(address, uint256) returns (bool)",
      ];
      const VAULT_ABI = [
        "function settle(address merchant, uint256 amount, string qrisRef) returns (bytes32)",
      ];
      const busdAddr = "0xe9e7CEA3DedcA5984780Bafc599bE2b0Fa6fC12";
      const token = new ethers.Contract(busdAddr, ERC20_ABI, wallet.signer);
      const vault = new ethers.Contract(vaultAddress, VAULT_ABI, wallet.signer);
      const amountWei = ethers.parseUnits(busdAmount.display, 18);
      const merchantAddr =
        merchantAddress || "0x0000000000000000000000000000000000000001";
      const approveTx = await token.approve(vaultAddress, amountWei);
      await approveTx.wait();
      const qrisRef =
        parsedQRIS.tags["59"] || selectedMerchant?.name || "QRIS_PAYMENT";
      const settleTx = await vault.settle(merchantAddr, amountWei, qrisRef);
      const receipt = await settleTx.wait();
      setSettleResult({
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        merchant: merchantAddr,
        amount: busdAmount.display,
      });
      setStep(6);
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 4000);
    } catch (err) {
      setError(err.message || "Settlement failed");
    } finally {
      setSettling(false);
    }
  }, [
    wallet,
    vaultAddress,
    merchantAddress,
    busdAmount,
    parsedQRIS,
    selectedMerchant,
  ]);

  const reset = useCallback(() => {
    setStep(0);
    setSelectedMerchant(null);
    setQrisString("");
    setParsedQRIS(null);
    setBusdAmount(null);
    setSettleResult(null);
    setError(null);
    setShowConfetti(false);
  }, []);

  return (
    <div className="min-h-screen pb-12" style={{ background: "#FAF7F2" }}>
      {/* Confetti */}
      {showConfetti && (
        <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
          {Array.from({ length: 40 }).map((_, i) => (
            <div
              key={i}
              className="confetti-piece"
              style={{
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 30}%`,
                background: i % 2 === 0 ? "#3D348B" : "#F0A202",
                borderRadius: i % 3 === 0 ? "50%" : "2px",
                transform: `translateY(${Math.random() * 300}px) rotate(${
                  Math.random() * 360
                }deg)`,
                animation: `fadeUp ${
                  0.5 + Math.random() * 0.5
                }s ease-out forwards`,
              }}
            />
          ))}
        </div>
      )}

      {/* Header */}
      <header className="max-w-5xl mx-auto px-4 pt-8 pb-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3">
              {/* Optical illusion: QRIS-Q-mark logo */}
              <div className="relative w-12 h-12 flex items-center justify-center">
                <svg viewBox="0 0 48 48" className="w-12 h-12">
                  <rect
                    x="4"
                    y="4"
                    width="14"
                    height="14"
                    rx="2"
                    fill="#3D348B"
                  />
                  <rect
                    x="8"
                    y="8"
                    width="6"
                    height="6"
                    rx="1"
                    fill="#FAF7F2"
                  />
                  <rect
                    x="30"
                    y="4"
                    width="14"
                    height="14"
                    rx="2"
                    fill="#3D348B"
                  />
                  <rect
                    x="34"
                    y="8"
                    width="6"
                    height="6"
                    rx="1"
                    fill="#FAF7F2"
                  />
                  <rect
                    x="4"
                    y="30"
                    width="14"
                    height="14"
                    rx="2"
                    fill="#3D348B"
                  />
                  <rect
                    x="8"
                    y="34"
                    width="6"
                    height="6"
                    rx="1"
                    fill="#FAF7F2"
                  />
                  <rect x="22" y="4" width="4" height="4" fill="#F0A202" />
                  <rect x="28" y="22" width="4" height="4" fill="#F0A202" />
                  <rect x="22" y="28" width="4" height="4" fill="#F0A202" />
                  <rect x="34" y="34" width="4" height="4" fill="#3D348B" />
                  <rect x="40" y="28" width="4" height="4" fill="#3D348B" />
                  <rect x="28" y="40" width="4" height="4" fill="#3D348B" />
                  <rect x="34" y="22" width="4" height="4" fill="#3D348B" />
                  <rect x="40" y="40" width="4" height="4" fill="#F0A202" />
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold" style={{ color: "#3D348B" }}>
                  QRIS Agentic Payments
                </h1>
                <p className="text-sm font-medium" style={{ color: "#8A8DCF" }}>
                  Web2.5 QR → stablecoin settlement on BNB Chain
                </p>
              </div>
            </div>
          </div>

          {/* Wallet Connect */}
          <button
            onClick={wallet.connect}
            disabled={wallet.connecting}
            className="ripple px-5 py-2.5 rounded-xl text-sm font-semibold transition-all hover:shadow-lg"
            style={{
              background: wallet.address ? "#F0A202" : "#3D348B",
              color: wallet.address ? "#1C1540" : "#FAF7F2",
            }}
          >
            {wallet.connecting ? (
              <span className="flex items-center gap-2">
                <span className="animate-spin">⟳</span> Connecting...
              </span>
            ) : wallet.address ? (
              <span className="flex items-center gap-2">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: "#3D348B" }}
                />
                {wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}
              </span>
            ) : (
              "🦊 Connect Wallet"
            )}
          </button>
        </div>

        {wallet.address && (
          <div
            className="glass-card mt-3 px-4 py-2 flex items-center gap-4 text-xs"
            style={{ color: "#6367BF" }}
          >
            <span>
              Chain:{" "}
              <span className="font-semibold" style={{ color: "#3D348B" }}>
                {wallet.chainId === 56
                  ? "BSC Mainnet"
                  : `Chain ${wallet.chainId}`}
              </span>
            </span>
            {wallet.busdBalance && (
              <span>
                BUSD:{" "}
                <span className="font-semibold" style={{ color: "#F0A202" }}>
                  {parseFloat(wallet.busdBalance).toFixed(2)}
                </span>
              </span>
            )}
          </div>
        )}
        {wallet.error && (
          <div className="glass-card mt-2 px-4 py-2 text-xs text-red-500">
            {wallet.error}
          </div>
        )}
      </header>

      {/* Hero: How it works — optical illusion tunnel */}
      <section className="max-w-5xl mx-auto px-4 py-6">
        <div className="glass-card p-6 flex flex-col md:flex-row items-center gap-6">
          {/* Tunnel visual — left side */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="flex flex-col items-center gap-1">
              <div
                className="text-xs font-semibold"
                style={{ color: "#3D348B" }}
              >
                QRIS
              </div>
              <div className="text-2xl">📱</div>
            </div>
            {/* Flow arrows — animated optical illusion */}
            <div className="flex flex-col gap-0.5">
              <div
                className="w-8 h-0.5"
                style={{
                  background: "#F0A202",
                  animation: "flowDash 0.6s linear infinite",
                }}
              />
              <div
                className="w-8 h-0.5"
                style={{
                  background: "#F0A202",
                  animation: "flowDash 0.6s linear infinite 0.1s",
                }}
              />
              <div
                className="w-8 h-0.5"
                style={{
                  background: "#F0A202",
                  animation: "flowDash 0.6s linear infinite 0.2s",
                }}
              />
            </div>
            <div className="flex flex-col items-center gap-1">
              <div
                className="text-xs font-semibold"
                style={{ color: "#3D348B" }}
              >
                Agent
              </div>
              <div className="text-2xl">🤖</div>
            </div>
            <div className="flex flex-col gap-0.5">
              <div
                className="w-8 h-0.5"
                style={{
                  background: "#3D348B",
                  animation: "flowDash 0.6s linear infinite 0.3s",
                }}
              />
              <div
                className="w-8 h-0.5"
                style={{
                  background: "#3D348B",
                  animation: "flowDash 0.6s linear infinite 0.4s",
                }}
              />
              <div
                className="w-8 h-0.5"
                style={{
                  background: "#3D348B",
                  animation: "flowDash 0.6s linear infinite 0.5s",
                }}
              />
            </div>
            <div className="flex flex-col items-center gap-1">
              <div
                className="text-xs font-semibold"
                style={{ color: "#3D348B" }}
              >
                BNB Chain
              </div>
              <div className="text-2xl">⛓️</div>
            </div>
          </div>
          {/* Right side: description */}
          <div className="flex-1">
            <h2
              className="text-sm font-semibold mb-1"
              style={{ color: "#3D348B" }}
            >
              Web2.5 Payment Flow
            </h2>
            <p className="text-sm leading-relaxed" style={{ color: "#6367BF" }}>
              An autonomous agent reads a QRIS code (Indonesia's national QR),
              validates it, converts IDR to BUSD via live rates, checks identity
              + spend policy, then settles on BNB Chain. No middleman. Just QR →
              agent → blockchain.
            </p>
          </div>
        </div>
      </section>

      {/* Main content */}
      <div className="max-w-5xl mx-auto px-4 grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left: Merchant selection */}
        <div className="lg:col-span-2 space-y-4">
          <div className="glass-card p-5">
            <h2
              className="text-sm font-bold mb-3 uppercase tracking-wider"
              style={{ color: "#3D348B" }}
            >
              Choose a Merchant
            </h2>
            <div className="space-y-2">
              {SAMPLE_MERCHANTS.map((m, i) => (
                <button
                  key={i}
                  onClick={() => selectMerchant(m)}
                  className={`merchant-card w-full text-left px-4 py-3 rounded-xl border-2 transition-all flex items-center gap-3 ${
                    selectedMerchant === m ? "selected" : ""
                  }`}
                  style={{
                    borderColor:
                      selectedMerchant === m
                        ? "#3D348B"
                        : "rgba(61,52,139,0.08)",
                    background:
                      selectedMerchant === m
                        ? "rgba(61,52,139,0.04)"
                        : "rgba(255,255,255,0.6)",
                  }}
                >
                  <span className="text-2xl">{m.emoji}</span>
                  <div className="flex-1">
                    <div
                      className="font-semibold text-sm"
                      style={{ color: "#3D348B" }}
                    >
                      {m.name}
                    </div>
                    <div className="text-xs" style={{ color: "#8A8DCF" }}>
                      {m.city} · IDR {m.amountIDR.toLocaleString()}
                    </div>
                  </div>
                  {selectedMerchant === m && (
                    <span style={{ color: "#F0A202" }} className="text-xl">
                      ✓
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* QRIS code display with scanner illusion */}
          {qrisString && (
            <div className="glass-card p-5 animate-fade-up">
              <h2
                className="text-sm font-bold mb-3 uppercase tracking-wider"
                style={{ color: "#3D348B" }}
              >
                Generated QRIS
              </h2>
              {/* Scanner frame optical illusion */}
              <div
                className="scanner-frame qris-bg p-4 mb-3"
                style={{ minHeight: "100px" }}
              >
                <div
                  className="font-mono text-[10px] break-all leading-tight"
                  style={{ color: "#3D348B", opacity: 0.8 }}
                >
                  {qrisString.slice(0, 120)}
                  {qrisString.length > 120 ? "..." : ""}
                </div>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span style={{ color: "#8A8DCF" }}>CRC16:</span>
                <span
                  className="font-mono font-semibold"
                  style={{ color: "#F0A202" }}
                >
                  {qrisString.slice(-4)}
                </span>
              </div>
            </div>
          )}

          {/* Contract config */}
          {wallet.address && (
            <div className="glass-card p-5 animate-fade-up">
              <h2
                className="text-sm font-bold mb-3 uppercase tracking-wider"
                style={{ color: "#3D348B" }}
              >
                Contract Config
              </h2>
              <input
                type="text"
                placeholder="QrisPaymentVault address"
                value={vaultAddress}
                onChange={(e) => setVaultAddress(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-xs font-mono mb-2 outline-none transition-all"
                style={{
                  background: "rgba(255,255,255,0.8)",
                  border: "1px solid rgba(61,52,139,0.15)",
                  color: "#3D348B",
                }}
              />
              <input
                type="text"
                placeholder="Merchant address (0x...01)"
                value={merchantAddress}
                onChange={(e) => setMerchantAddress(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-xs font-mono outline-none transition-all"
                style={{
                  background: "rgba(255,255,255,0.8)",
                  border: "1px solid rgba(61,52,139,0.15)",
                  color: "#3D348B",
                }}
              />
            </div>
          )}
        </div>

        {/* Right: Pipeline */}
        <div className="lg:col-span-3" ref={pipelineRef}>
          <div className="glass-card p-6">
            {/* Step progress bar */}
            <div className="flex items-center justify-between mb-6 overflow-x-auto pb-2">
              {STEPS.map((s, i) => (
                <div key={s.id} className="flex items-center flex-shrink-0">
                  <div className="flex flex-col items-center gap-1.5">
                    <div
                      className={`step-node ${
                        i < step ? "done" : i === step ? "active" : "pending"
                      }`}
                    >
                      {i < step ? "✓" : s.icon}
                    </div>
                    <span
                      className="text-[10px] font-medium"
                      style={{ color: i <= step ? "#3D348B" : "#B1B6DF" }}
                    >
                      {s.label}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div
                      className="w-6 md:w-10 h-0.5 mx-1 rounded-full"
                      style={{
                        background: i < step ? "#F0A202" : "#E5E3F0",
                        transition: "background 0.3s",
                      }}
                    />
                  )}
                </div>
              ))}
            </div>

            {/* Step content */}
            <div className="min-h-[280px]">
              {/* Step 0: Initial state */}
              {step === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  {/* Optical illusion: pulsing rings */}
                  <div className="relative w-24 h-24 flex items-center justify-center mb-4">
                    <div
                      className="absolute inset-0 rounded-full border-2 animate-pulse-ring"
                      style={{ borderColor: "#3D348B" }}
                    />
                    <div
                      className="absolute inset-0 rounded-full border-2 animate-pulse-ring"
                      style={{ borderColor: "#F0A202", animationDelay: "0.5s" }}
                    />
                    <div className="text-4xl opacity-50">🧑‍💻</div>
                  </div>
                  <p
                    className="text-sm font-medium"
                    style={{ color: "#3D348B" }}
                  >
                    Select a merchant to start
                  </p>
                  <p className="text-xs mt-1" style={{ color: "#8A8DCF" }}>
                    The agent will scan, parse, and validate the QRIS code
                  </p>
                </div>
              )}

              {/* Step 1: Parse */}
              {step === 1 && selectedMerchant && (
                <div className="animate-fade-up">
                  <h3
                    className="text-base font-bold mb-3"
                    style={{ color: "#3D348B" }}
                  >
                    QRIS Parsing & CRC Validation
                  </h3>
                  <div className="scanner-frame p-4 mb-4">
                    <div
                      className="font-mono text-xs break-all"
                      style={{ color: "#3D348B", opacity: 0.7 }}
                    >
                      {qrisString.slice(0, 80)}...
                    </div>
                    {/* QRIS tags extracted */}
                    <div className="mt-3 space-y-1 text-xs">
                      <div className="flex gap-2">
                        <span
                          className="font-mono font-bold"
                          style={{ color: "#F0A202" }}
                        >
                          tag00
                        </span>
                        <span style={{ color: "#3D348B" }}>
                          Payload format indicator
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <span
                          className="font-mono font-bold"
                          style={{ color: "#F0A202" }}
                        >
                          tag26
                        </span>
                        <span style={{ color: "#3D348B" }}>
                          Merchant account info
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <span
                          className="font-mono font-bold"
                          style={{ color: "#F0A202" }}
                        >
                          tag53
                        </span>
                        <span style={{ color: "#3D348B" }}>
                          Currency: IDR (360)
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <span
                          className="font-mono font-bold"
                          style={{ color: "#F0A202" }}
                        >
                          tag54
                        </span>
                        <span style={{ color: "#3D348B" }}>
                          Amount: {selectedMerchant.amountIDR.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <span
                          className="font-mono font-bold"
                          style={{ color: "#F0A202" }}
                        >
                          tag63
                        </span>
                        <span style={{ color: "#3D348B" }}>
                          CRC16: {qrisString.slice(-4)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={doParse}
                    className="ripple px-5 py-2.5 rounded-xl text-sm font-semibold transition-all hover:shadow-lg"
                    style={{ background: "#3D348B", color: "#FAF7F2" }}
                  >
                    🔍 Parse & Validate CRC16-CCITT
                  </button>
                </div>
              )}

              {/* Step 2: FX Convert */}
              {step === 2 && parsedQRIS && (
                <div className="animate-fade-up">
                  <h3
                    className="text-base font-bold mb-4"
                    style={{ color: "#3D348B" }}
                  >
                    Exchange Rate Conversion
                  </h3>
                  {/* Optical illusion: IDR → BUSD transform */}
                  <div className="flex items-center gap-4 mb-4">
                    <div
                      className="flex-1 text-center p-4 rounded-xl"
                      style={{ background: "rgba(61,52,139,0.06)" }}
                    >
                      <div
                        className="text-xs font-medium mb-1"
                        style={{ color: "#8A8DCF" }}
                      >
                        IDR Amount
                      </div>
                      <div
                        className="text-2xl font-bold"
                        style={{ color: "#3D348B" }}
                      >
                        {parseInt(
                          parsedQRIS.tags["54"] || "0"
                        ).toLocaleString()}
                      </div>
                      <div className="text-xs" style={{ color: "#8A8DCF" }}>
                        Indonesian Rupiah
                      </div>
                    </div>
                    {/* Animated arrow */}
                    <div className="flex flex-col items-center">
                      <div style={{ color: "#F0A202", fontSize: "24px" }}>
                        →
                      </div>
                      <div
                        className="text-[10px] font-mono"
                        style={{ color: "#F0A202" }}
                      >
                        {liveRate ? "Live" : "Static"}
                      </div>
                    </div>
                    <div
                      className="flex-1 text-center p-4 rounded-xl"
                      style={{ background: "rgba(240,162,2,0.08)" }}
                    >
                      <div
                        className="text-xs font-medium mb-1"
                        style={{ color: "#F0A202" }}
                      >
                        BUSD Amount
                      </div>
                      <div
                        className="text-2xl font-bold"
                        style={{ color: "#3D348B" }}
                      >
                        ~
                        {(
                          parseInt(parsedQRIS.tags["54"] || "0") /
                          (liveRate || RATE_IDR_PER_BUSD)
                        ).toFixed(4)}
                      </div>
                      <div className="text-xs" style={{ color: "#8A8DCF" }}>
                        Binance USD
                      </div>
                    </div>
                  </div>
                  <div
                    className="flex items-center justify-between text-xs mb-3 px-2"
                    style={{ color: "#8A8DCF" }}
                  >
                    <span>
                      Source: {liveRate ? "CoinGecko ✅" : "Static fallback"}
                    </span>
                    <span>
                      1 BUSD ={" "}
                      {Math.round(
                        liveRate || RATE_IDR_PER_BUSD
                      ).toLocaleString()}{" "}
                      IDR
                    </span>
                  </div>
                  <button
                    onClick={doFX}
                    className="ripple px-5 py-2.5 rounded-xl text-sm font-semibold transition-all hover:shadow-lg"
                    style={{ background: "#3D348B", color: "#FAF7F2" }}
                  >
                    💱 Convert IDR → BUSD
                  </button>
                </div>
              )}

              {/* Step 3: Identity */}
              {step === 3 && busdAmount && (
                <div className="animate-fade-up">
                  <h3
                    className="text-base font-bold mb-3"
                    style={{ color: "#3D348B" }}
                  >
                    Agent Identity (ERC-8004)
                  </h3>
                  <div
                    className="p-4 rounded-xl mb-3"
                    style={{ background: "rgba(61,52,139,0.04)" }}
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center text-xl"
                        style={{ background: "#3D348B", color: "#F0A202" }}
                      >
                        🤖
                      </div>
                      <div>
                        <div
                          className="font-semibold text-sm"
                          style={{ color: "#3D348B" }}
                        >
                          agent_qris_pay_v1
                        </div>
                        <div className="text-xs" style={{ color: "#8A8DCF" }}>
                          ERC-8004 registered agent
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span style={{ color: "#8A8DCF" }}>BUSD Amount</span>
                        <span
                          className="font-mono font-semibold"
                          style={{ color: "#3D348B" }}
                        >
                          {busdAmount.display} BUSD
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span style={{ color: "#8A8DCF" }}>
                          Reputation Score
                        </span>
                        <span
                          className="font-semibold"
                          style={{ color: "#F0A202" }}
                        >
                          85 / 100 ✅
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={doIdentity}
                    className="ripple px-5 py-2.5 rounded-xl text-sm font-semibold transition-all hover:shadow-lg"
                    style={{ background: "#3D348B", color: "#FAF7F2" }}
                  >
                    🆔 Verify Identity
                  </button>
                </div>
              )}

              {/* Step 4: Policy */}
              {step === 4 && (
                <div className="animate-fade-up">
                  <h3
                    className="text-base font-bold mb-3"
                    style={{ color: "#3D348B" }}
                  >
                    Spend Policy Check
                  </h3>
                  <div className="space-y-2 mb-3">
                    {[
                      {
                        label: "Per-tx cap",
                        status: "Within limit",
                        icon: "✅",
                      },
                      {
                        label: "Daily cap",
                        status: "Within limit",
                        icon: "✅",
                      },
                      {
                        label: "Allowlist",
                        status: "Merchant allowed",
                        icon: "✅",
                      },
                      { label: "Blocklist", status: "Not blocked", icon: "✅" },
                    ].map((p, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between px-4 py-2.5 rounded-lg"
                        style={{
                          background: "rgba(240,162,2,0.05)",
                          border: "1px solid rgba(240,162,2,0.15)",
                        }}
                      >
                        <span
                          className="text-sm font-medium"
                          style={{ color: "#3D348B" }}
                        >
                          {p.label}
                        </span>
                        <span
                          className="text-sm font-semibold"
                          style={{ color: "#F0A202" }}
                        >
                          {p.icon} {p.status}
                        </span>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={doPolicy}
                    className="ripple px-5 py-2.5 rounded-xl text-sm font-semibold transition-all hover:shadow-lg"
                    style={{ background: "#3D348B", color: "#FAF7F2" }}
                  >
                    🛡️ Approve Payment
                  </button>
                </div>
              )}

              {/* Step 5: Settle */}
              {step === 5 && (
                <div className="animate-fade-up">
                  <h3
                    className="text-base font-bold mb-3"
                    style={{ color: "#3D348B" }}
                  >
                    On-Chain Settlement
                  </h3>
                  {/* Tunnel optical illusion */}
                  <div className="flex flex-col items-center mb-4">
                    <div className="tunnel-entrance" />
                    <div
                      className="text-xs mt-2 font-medium"
                      style={{ color: "#8A8DCF" }}
                    >
                      BNB Chain Settlement Layer
                    </div>
                  </div>
                  <div
                    className="p-4 rounded-xl mb-3 space-y-2 text-sm"
                    style={{ background: "rgba(61,52,139,0.04)" }}
                  >
                    <div className="flex justify-between">
                      <span style={{ color: "#8A8DCF" }}>Amount</span>
                      <span
                        className="font-mono font-semibold"
                        style={{ color: "#3D348B" }}
                      >
                        {busdAmount?.display} BUSD
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: "#8A8DCF" }}>Merchant</span>
                      <span
                        className="font-mono text-xs"
                        style={{ color: "#3D348B" }}
                      >
                        {merchantAddress || "0x...01"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: "#8A8DCF" }}>Vault</span>
                      <span
                        className="font-mono text-xs"
                        style={{ color: "#3D348B" }}
                      >
                        {vaultAddress || "not set"}
                      </span>
                    </div>
                  </div>
                  {!wallet.address ? (
                    <p className="text-xs" style={{ color: "#F0A202" }}>
                      ⚠ Connect your wallet to settle on-chain
                    </p>
                  ) : !vaultAddress ? (
                    <p className="text-xs" style={{ color: "#F0A202" }}>
                      ⚠ Enter the QrisPaymentVault contract address
                    </p>
                  ) : (
                    <button
                      onClick={doSettle}
                      disabled={settling}
                      className="ripple px-5 py-2.5 rounded-xl text-sm font-semibold transition-all hover:shadow-lg disabled:opacity-50"
                      style={{ background: "#3D348B", color: "#FAF7F2" }}
                    >
                      {settling ? (
                        <span className="flex items-center gap-2">
                          {/* Tunnel loading spinner */}
                          <span
                            className="inline-block w-4 h-4 border-2 rounded-full animate-spin"
                            style={{
                              borderColor: "#F0A202",
                              borderTopColor: "transparent",
                            }}
                          />
                          Settling...
                        </span>
                      ) : (
                        "⛓️ Settle on BNB Chain"
                      )}
                    </button>
                  )}
                </div>
              )}

              {/* Step 6: Receipt */}
              {step === 6 && settleResult && (
                <div className="animate-fade-up text-center">
                  <div className="text-5xl mb-3">✅</div>
                  <h3
                    className="text-lg font-bold mb-3"
                    style={{ color: "#3D348B" }}
                  >
                    Payment Settled!
                  </h3>
                  {/* Optical illusion: receipt card with depth */}
                  <div
                    className="max-w-md mx-auto p-4 rounded-xl text-left text-sm space-y-2"
                    style={{
                      background: "rgba(240,162,2,0.06)",
                      border: "1px solid rgba(240,162,2,0.2)",
                      boxShadow: "0 4px 16px rgba(61,52,139,0.10)",
                    }}
                  >
                    <div className="flex justify-between items-center">
                      <span style={{ color: "#8A8DCF" }}>Tx Hash</span>
                      <a
                        href={`https://bscscan.com/tx/${settleResult.txHash}`}
                        target="_blank"
                        rel="noopener"
                        className="font-mono text-xs hover:underline"
                        style={{ color: "#3D348B" }}
                      >
                        {settleResult.txHash.slice(0, 10)}...
                        {settleResult.txHash.slice(-8)}
                      </a>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: "#8A8DCF" }}>Block</span>
                      <span className="font-mono" style={{ color: "#3D348B" }}>
                        #{settleResult.blockNumber}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: "#8A8DCF" }}>Amount</span>
                      <span className="font-bold" style={{ color: "#F0A202" }}>
                        {settleResult.amount} BUSD
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span style={{ color: "#8A8DCF" }}>Merchant</span>
                      <span
                        className="font-mono text-xs"
                        style={{ color: "#3D348B" }}
                      >
                        {settleResult.merchant.slice(0, 8)}...
                        {settleResult.merchant.slice(-4)}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={reset}
                    className="ripple mt-4 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all hover:shadow-lg"
                    style={{ background: "#F0A202", color: "#1C1540" }}
                  >
                    ↻ New Payment
                  </button>
                </div>
              )}
            </div>

            {error && (
              <div
                className="mt-3 px-4 py-2 rounded-lg text-xs"
                style={{
                  background: "rgba(255,0,0,0.05)",
                  border: "1px solid rgba(255,0,0,0.15)",
                  color: "#DC2626",
                }}
              >
                ⚠ {error}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="max-w-5xl mx-auto mt-8 px-4 text-center">
        <p className="text-xs" style={{ color: "#B1B6DF" }}>
          QRIS Agentic Payments · BNB Chain AI Hack Cookbook Challenge
        </p>
      </footer>
    </div>
  );
}
