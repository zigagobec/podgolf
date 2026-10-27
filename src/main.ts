import { App } from './app';
import { initGpu } from './render/gpu';
import type { RatInput } from './game/world';

declare global {
  interface Window {
    __podgolf?: {
      app: App;
      start: () => void;
      setInput: (player: number, input: RatInput | null) => void;
      fixedDt: (dt: number | null) => void;
    };
  }
}

function fatal(html: string): void {
  document.getElementById('loading')?.remove();
  const box = document.createElement('div');
  box.className = 'fatal';
  box.innerHTML = html;
  document.body.appendChild(box);
}

const NO_GPU = `<h1>PODGOLF</h1><p>Ta brskalnik ne podpira WebGPU.</p><p>Odpri igro v novejšem Chromu ali Edgu (namizje), Chromu na Androidu ali Safariju 26+.</p>`;

async function boot() {
  const canvas = document.getElementById('gfx') as HTMLCanvasElement;
  const gpu = await initGpu(canvas);
  if (!gpu) return fatal(NO_GPU);
  gpu.device.lost.then((info) => {
    if (info.reason !== 'destroyed') fatal('<h1>Ups</h1><p>Grafična kartica je izgubila povezavo. Osveži stran.</p>');
  });

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    let h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    // Keep the pixel count sane on big screens.
    const max = 2560 * 1440;
    if (w * h > max) {
      const k = Math.sqrt(max / (w * h));
      w = Math.floor(w * k);
      h = Math.floor(h * k);
    }
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  };
  resize();
  addEventListener('resize', resize);

  const app = new App(gpu);
  document.getElementById('loading')?.remove();
  window.__podgolf = {
    app,
    start: () => app.startMatch(),
    setInput: (p, i) => {
      app.input.override[p] = i;
    },
    fixedDt: (dt) => {
      app.fixedDt = dt;
    },
  };
  const loop = (t: number) => {
    resize();
    app.frame(t);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

boot().catch((err) => {
  console.error(err);
  fatal(NO_GPU);
});
