import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Sora", "ui-sans-serif", "system-ui"],
        sans: ["Manrope", "ui-sans-serif", "system-ui"],
      },
      colors: {
        sound: {
          50: "#eefbfb",
          100: "#d2f5f3",
          200: "#a5eae4",
          300: "#72d9d3",
          400: "#42bdb9",
          500: "#199f9e",
          600: "#128284",
          700: "#10686b",
          800: "#124f53",
          900: "#143f43",
        },
        fog: "#f4f8f8",
        cedar: "#153236",
        slateblue: "#203d45",
        moss: "#6c8e7d",
      },
      boxShadow: {
        shell: "0 20px 60px rgba(19, 48, 54, 0.10)",
        soft: "0 14px 32px rgba(19, 48, 54, 0.08)",
      },
      backgroundImage: {
        "hero-fade":
          "radial-gradient(circle at top left, rgba(25, 159, 158, 0.18), transparent 32%), radial-gradient(circle at top right, rgba(87, 131, 110, 0.14), transparent 26%)",
      },
    },
  },
  plugins: [],
};

export default config;
