/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        indigo: {
          50: "#EEF0FB",
          100: "#D8DCEF",
          200: "#B1B6DF",
          300: "#8A8DCF",
          400: "#6367BF",
          500: "#3D348B",
          600: "#322B70",
          700: "#271F56",
          800: "#1C1540",
          900: "#120A2A",
        },
        amber: {
          50: "#FFF9EB",
          100: "#FEF0C7",
          200: "#FDE08A",
          300: "#FCD14D",
          400: "#F0A202",
          500: "#D48E02",
          600: "#B07502",
          700: "#8C5C01",
        },
        cream: "#FAF7F2",
        ink: "#1C1540",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["JetBrains Mono", "Consolas", "monospace"],
      },
      animation: {
        "slide-in": "slideIn 0.4s ease-out",
        "fade-up": "fadeUp 0.5s ease-out",
        "pulse-ring": "pulseRing 2s ease-out infinite",
        "scan-line": "scanLine 1.5s ease-in-out infinite",
        "coin-flip": "coinFlip 0.8s ease-out",
        "flow-dash": "flowDash 1.5s linear infinite",
      },
      keyframes: {
        slideIn: {
          "0%": { transform: "translateX(-20px)", opacity: "0" },
          "100%": { transform: "translateX(0)", opacity: "1" },
        },
        fadeUp: {
          "0%": { transform: "translateY(15px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        pulseRing: {
          "0%": { transform: "scale(1)", opacity: "1" },
          "100%": { transform: "scale(2)", opacity: "0" },
        },
        scanLine: {
          "0%,100%": { top: "0%" },
          "50%": { top: "100%" },
        },
        coinFlip: {
          "0%": { transform: "rotateY(0deg)" },
          "100%": { transform: "rotateY(360deg)" },
        },
        flowDash: {
          "0%": { strokeDashoffset: "20" },
          "100%": { strokeDashoffset: "0" },
        },
      },
    },
  },
  plugins: [],
};
