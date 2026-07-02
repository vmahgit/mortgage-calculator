import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'))

// Korte git-commit-hash voor de versie-indicator in de UI, zodat je altijd kunt zien welke
// checkpoint er precies draait. Valt terug op "dev" buiten een git-repo (bijv. bij een
// gedownloade zip).
let commitHash = 'dev'
try {
  commitHash = execSync('git rev-parse --short HEAD').toString().trim()
} catch {
  // geen git-repo beschikbaar, laat de fallback staan
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __GIT_COMMIT__: JSON.stringify(commitHash),
  },
})
