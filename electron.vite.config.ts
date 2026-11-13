import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createRequire } from 'node:module'

const loadPreset = (name: string) => createRequire(import.meta.url)('butterchurn-presets/presets/converted/' + name + '.json')
const presets = {
  milkdrop: loadPreset('_Eo.S. + Phat - spectrum bubble field - Geiss-softened'),
  ferrofluid: loadPreset('cope - ferrofluid'),
  stainedGlass: loadPreset('Eo.S. + Zylot - skylight (Stained Glass Majesty mix)'),
  tunnel: loadPreset('Aderrasi - Kevlar Tunnel')
}

// Compile the bundled MilkDrop equations at build time so the renderer can
// keep its Content Security Policy and never evaluate preset text at runtime.
function presetSource(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(presetSource).join(',') + ']'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  const fields = Object.entries(value).flatMap(([key, field]) => {
    if (key.endsWith('_eqs_str')) {
      const name = key.slice(0, -4)
      if (!field && (name === 'pixel_eqs' || name === 'point_eqs')) return []
      return [JSON.stringify(name) + ':function(a){' + field + '\nreturn a}']
    }
    return [JSON.stringify(key) + ':' + presetSource(field)]
  })
  return '{' + fields.join(',') + '}'
}

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react(), tailwindcss(), {
      name: 'bundled-milkdrop-preset',
      resolveId(id) { if (id === 'virtual:milkdrop-preset') return '\0' + id },
      load(id) { if (id === '\0virtual:milkdrop-preset') return 'export default ' + presetSource(presets) }
    }]
  }
})
