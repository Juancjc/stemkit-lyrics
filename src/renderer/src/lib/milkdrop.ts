import butterchurn from 'butterchurn'
import presets from 'virtual:milkdrop-preset'
import { engine } from './engine'

export function startMilkDrop(canvas: HTMLCanvasElement, style: keyof typeof presets, onFailure: () => void): () => void {
  const output = engine.mixOutput()
  const width = Math.max(1, canvas.clientWidth)
  const height = Math.max(1, canvas.clientHeight)
  canvas.width = width
  canvas.height = height
  const visualizer = butterchurn.createVisualizer(output.context, canvas, { width, height, pixelRatio: 1 })
  visualizer.loadPreset(presets[style], 0)
  visualizer.connectAudio(output)
  const resize = new ResizeObserver(() => {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (w && h && (canvas.width !== w || canvas.height !== h)) {
      canvas.width = w
      canvas.height = h
      visualizer.setRendererSize(w, h)
    }
  })
  resize.observe(canvas)
  let frame = 0
  function draw(): void {
    try {
      visualizer.render()
      frame = requestAnimationFrame(draw)
    } catch {
      onFailure()
    }
  }
  frame = requestAnimationFrame(draw)
  return () => {
    cancelAnimationFrame(frame)
    resize.disconnect()
    visualizer.disconnectAudio(output)
  }
}
