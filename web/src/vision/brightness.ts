/**
 * How bright the camera picture is: mean luma, 0 to 1, for the setup check.
 *
 * Read from a 32×18 thumbnail, which averages the picture for free on the
 * GPU and costs a 2.3 kB readback; once a second is plenty for lighting.
 */

const WIDTH = 32;
const HEIGHT = 18;

export class Brightness {
  private canvas = document.createElement("canvas");
  private context: CanvasRenderingContext2D | null;
  private lastMs = -Infinity;
  private value: number | null = null;

  constructor(private readonly everyMs = 1000) {
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    this.context = this.canvas.getContext("2d", { willReadFrequently: true });
  }

  /** Measures at most once per `everyMs`; returns the latest value. */
  sample(video: HTMLVideoElement, nowMs: number): number | null {
    if (!this.context || video.readyState < 2 || nowMs - this.lastMs < this.everyMs) return this.value;
    this.lastMs = nowMs;
    this.context.drawImage(video, 0, 0, WIDTH, HEIGHT);
    const data = this.context.getImageData(0, 0, WIDTH, HEIGHT).data;
    let sum = 0;
    // Rec. 601 luma weights, as webcams encode.
    for (let i = 0; i < data.length; i += 4) sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    this.value = sum / (WIDTH * HEIGHT * 255);
    return this.value;
  }

  get latest(): number | null {
    return this.value;
  }
}
