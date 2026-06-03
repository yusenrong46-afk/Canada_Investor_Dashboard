import type { Config } from "tailwindcss";

const brand = {
  50: "#f0fdfa",
  100: "#ccfbf1",
  200: "#99f6e4",
  300: "#5eead4",
  400: "#2dd4bf",
  500: "#14b8a6",
  600: "#0d9488",
  700: "#0f766e",
  800: "#115e59",
  900: "#134e4a",
};

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Sora", "ui-sans-serif", "system-ui"],
        sans: ["Manrope", "ui-sans-serif", "system-ui"],
      },
      colors: {
        brand,
        // Neutrals / surfaces
        ink: "#0f172a",
        body: "#475569",
        muted: "#94a3b8",
        line: "#e2e8f0",
        surface: "#ffffff",
        canvas: "#f8fafc",
        sidebar: "#0b1220",
        // Semantic
        success: "#059669",
        warning: "#d97706",
        danger: "#e11d48",
        // Legacy aliases (kept so older class names keep compiling during migration)
        sound: brand,
        fog: "#f8fafc",
        cedar: "#0f172a",
        slateblue: "#115e59",
        moss: "#6c8e7d",
      },
      borderRadius: {
        card: "1rem",
        field: "0.625rem",
        pill: "9999px",
      },
      boxShadow: {
        xs: "0 1px 2px rgba(15, 23, 42, 0.04)",
        card: "0 1px 3px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04)",
        hover: "0 8px 24px rgba(15, 23, 42, 0.08)",
        hero: "0 12px 40px rgba(13, 148, 136, 0.12)",
        // Legacy aliases
        soft: "0 1px 3px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04)",
        shell: "0 12px 40px rgba(13, 148, 136, 0.12)",
      },
      backgroundImage: {
        "hero-fade":
          "radial-gradient(circle at top left, rgba(20, 184, 166, 0.16), transparent 34%), radial-gradient(circle at top right, rgba(13, 148, 136, 0.10), transparent 28%)",
      },
    },
  },
  plugins: [],
};

export default config;
