import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { componentGretaTagger } from "@questlabs/greta-tagger";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "0.0.0.0",
    port: 5173,
    hmr: {
      overlay: true,
    },
    watch: {
      // Ignore node_modules to prevent Vite from restarting when dependencies are installed
      // This prevents 429 errors during dependency installation
      ignored: ['**/node_modules/**', '**/dist/**'],
    },
  },
  optimizeDeps: {
    // Disable automatic dependency discovery to prevent Vite from reloading
    // when new dependencies are detected in code changes
    disabled: false, // Keep optimization enabled for performance
    // But don't auto-reload when new deps are found - require manual restart
    force: false,
  },
  // Use writable cache directory from env (Cloud Run overlayfs doesn't like node_modules/.vite)
  // Falls back to .vite in project dir if env not set
  cacheDir: process.env.VITE_CACHE_DIR || path.resolve(__dirname, ".vite"),
  plugins: [componentGretaTagger(), react()],
  resolve: {
    // Force all packages to use the same React instance (prevents "Invalid hook call" errors)
    // This is critical when using pnpm's symlinked node_modules structure
    dedupe: ['react', 'react-dom', 'react-router-dom', 'scheduler'],
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
