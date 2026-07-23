import type { Config } from "tailwindcss";

const brand = {
  50: "#eef8f7",
  100: "#d5efed",
  200: "#aedfdc",
  300: "#7ac7c2",
  400: "#3fa8a2",
  500: "#0b6e6b",
  600: "#0a5f5c",
  700: "#084c4a",
  800: "#073c3a",
  900: "#052c2b",
};

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Fraunces", "ui-serif", "Georgia", "serif"],
        sans: ["Source Sans 3", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        brand,
        ink: "#15202b",
        body: "#3d4f5f",
        muted: "#6b7c8c",
        line: "#d7e0e8",
        surface: "#ffffff",
        canvas: "#f4f7fa",
        success: "#1f7a5c",
        warning: "#b7791f",
        danger: "#c23b4a",
        sound: brand,
        fog: "#f4f7fa",
        cedar: "#15202b",
        slateblue: "#0a5f5c",
        moss: "#5e7d74",
      },
      borderRadius: {
        card: "0.875rem",
        field: "0.5rem",
        pill: "9999px",
      },
      boxShadow: {
        xs: "0 1px 2px rgba(21, 32, 43, 0.04)",
        card: "0 1px 2px rgba(21, 32, 43, 0.04), 0 8px 24px rgba(21, 32, 43, 0.04)",
        hover: "0 10px 28px rgba(21, 32, 43, 0.08)",
        hero: "0 16px 40px rgba(11, 110, 107, 0.08)",
        soft: "0 1px 2px rgba(21, 32, 43, 0.04), 0 8px 24px rgba(21, 32, 43, 0.04)",
        shell: "0 16px 40px rgba(11, 110, 107, 0.08)",
      },
      backgroundImage: {
        "hero-fade":
          "radial-gradient(ellipse 80% 60% at 0% 0%, rgba(11, 110, 107, 0.10), transparent 55%), radial-gradient(ellipse 60% 50% at 100% 0%, rgba(61, 79, 95, 0.06), transparent 50%)",
        "canvas-wash":
          "linear-gradient(180deg, #eef4f8 0%, #f4f7fa 42%, #f7f9fb 100%)",
      },
    },
  },
  plugins: [],
};

export default config;
