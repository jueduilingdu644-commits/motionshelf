const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

let viteCli

try {
  viteCli = require.resolve('vite/bin/vite.js')
} catch {
  const workspace = path.join(process.cwd(), 'node_modules', '.pnpm')
  const vitePackage = fs.existsSync(workspace) ? fs.readdirSync(workspace).find((entry) => entry.startsWith('vite@')) : null
  viteCli = vitePackage ? path.join(workspace, vitePackage, 'node_modules', 'vite', 'bin', 'vite.js') : null
}

if (!viteCli) {
  console.error('Vite is not installed. Run pnpm install first.')
  process.exit(1)
}

import(pathToFileURL(viteCli).href)
