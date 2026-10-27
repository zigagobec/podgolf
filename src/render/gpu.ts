export interface Gpu {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  canvas: HTMLCanvasElement;
}

/** Resolve a WebGPU device for the canvas, or null if the browser can't provide one. */
export async function initGpu(canvas: HTMLCanvasElement): Promise<Gpu | null> {
  if (!('gpu' in navigator) || !navigator.gpu) return null;
  let adapter: GPUAdapter | null = null;
  try {
    adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  if (!adapter) return null;
  let device: GPUDevice;
  try {
    device = await adapter.requestDevice();
  } catch {
    return null;
  }
  device.addEventListener('uncapturederror', (e) => console.error('WebGPU error:', (e as GPUUncapturedErrorEvent).error.message));
  const context = canvas.getContext('webgpu');
  if (!context) return null;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  return { device, context, format, canvas };
}
