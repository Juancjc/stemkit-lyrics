declare module 'virtual:milkdrop-preset' {
  const preset: Record<'milkdrop' | 'ferrofluid' | 'stainedGlass' | 'tunnel', object>
  export default preset
}

declare module 'butterchurn' {
  const butterchurn: {
    createVisualizer(context: BaseAudioContext, canvas: HTMLCanvasElement, options: { width: number; height: number; pixelRatio: number }): {
      connectAudio(node: AudioNode): void
      disconnectAudio(node: AudioNode): void
      loadPreset(preset: object, transition: number): void
      setRendererSize(width: number, height: number): void
      render(): void
    }
  }
  export default butterchurn
}
