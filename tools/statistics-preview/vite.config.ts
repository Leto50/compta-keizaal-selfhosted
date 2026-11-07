import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url))

// This standalone entry never loads the application's router or backend credentials.
export default defineConfig({
  root: local("./"),
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: [
      { find: "@/lib/auth-client", replacement: local("./fixtures.ts") },
      { find: "@/hooks/use-permissions", replacement: local("./fixtures.ts") },
      { find: "@/hooks/use-site-name", replacement: local("./fixtures.ts") },
      { find: "convex/react", replacement: local("./fixtures.ts") },
      { find: "@", replacement: local("../../src") },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 3100,
    strictPort: true,
    fs: { allow: [local("../../")] },
  },
})
