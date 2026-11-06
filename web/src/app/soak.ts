/**
 * The 30-minute soak test (Phase 6), unattended.
 *
 *   http://localhost:3004/?debug&source=soak            30 minutes
 *   http://localhost:3004/?debug&source=soak&minutes=5  shorter
 *
 * The note exercises play themselves through the scripted source
 * (`lesson/demo.ts`, mistakes included), one after another, alternating loop
 * and play-through and going round all six. Each session opens and closes
 * the audio graph, as a student's would. Every minute a `[soak]` line goes to
 * the console, and `window.__soak` holds the latest report: sessions, notes,
 * pluck-to-screen latency p50/p95, the longest gap between animation frames,
 * long tasks, and the JS heap (Chrome only). Soak sessions are not stored.
 *
 * Building the scripted signal takes 350-925 ms of main thread per session
 * (measured in the pane: the whole performance is synthesised up front). That
 * is the test rig, not the app, whose own start (context and worklet) took
 * 24 ms; `exclude` keeps it out of the frame gaps and long tasks.
 *
 * The tab must stay visible: a hidden tab gets no animation frames, which is
 * exactly what the soak is measuring, and it ends the session in progress (the
 * microphone is released). `hidden` counts how often that happened; a run with
 * any is not valid. Open the first exercise by hand: the rest follow.
 */

import { LatencyStats } from "../audio/latency";
import type { SessionSummary } from "../lesson/NoteSession";

export interface SoakReport {
  minutes: number;
  sessions: number;
  notes: number;
  clean: number;
  latencyP50: number;
  latencyP95: number;
  latencyCount: number;
  /** The longest gap between two animation frames, ms: a freeze would show here. */
  worstFrameGapMs: number;
  /** Gaps over 100 ms (six dropped frames at 60 Hz). */
  longFrameGaps: number;
  longTasks: number;
  /** Times the tab was hidden: a hidden tab ends the session, so the run is not valid. */
  hidden: number;
  heapMB: number | null;
  heapStartMB: number | null;
  done: boolean;
}

type MemoryPerformance = Performance & { memory?: { usedJSHeapSize: number } };

const heapMB = () => {
  const memory = (performance as MemoryPerformance).memory;
  return memory ? memory.usedJSHeapSize / 1048576 : null;
};

export class SoakRun {
  private readonly started = performance.now();
  private readonly endsAt: number;
  private latency = new LatencyStats(200_000);
  private sessions = 0;
  private notes = 0;
  private clean = 0;
  private worstGap = 0;
  private longGaps = 0;
  private longTasks = 0;
  private hidden = 0;
  private readonly heapStart = heapMB();
  private lastFrame = performance.now();
  private timer: number;
  /** Main-thread windows spent on the test rig, not the app. */
  private excluded: [number, number][] = [];

  constructor(minutes: number) {
    this.endsAt = this.started + minutes * 60_000;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (!this.isExcluded(entry.startTime, entry.startTime + entry.duration)) this.longTasks++;
      }).observe({ type: "longtask", buffered: false });
    } catch {
      // Not every browser reports long tasks; the frame gaps still do.
    }
    const frame = (now: number) => {
      const gap = now - this.lastFrame;
      if (!this.isExcluded(this.lastFrame, now)) {
        if (gap > this.worstGap) this.worstGap = gap;
        if (gap > 100) this.longGaps++;
      }
      this.lastFrame = now;
      if (!this.done) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden || this.done) return;
      this.hidden++;
      console.warn("[soak] the tab was hidden: the session in progress ends and the run is not valid");
    });
    this.timer = window.setInterval(() => this.report(), 60_000);
    console.info(`[soak] started: ${minutes} min`);
  }

  get done(): boolean {
    return performance.now() >= this.endsAt;
  }

  /** Time spent building the test signal: not counted against the app. */
  exclude(from: number, to: number) {
    this.excluded.push([from, to]);
    if (this.excluded.length > 20) this.excluded.shift();
  }

  private isExcluded(from: number, to: number): boolean {
    return this.excluded.some(([a, b]) => from < b && to > a);
  }

  addLatency(ms: number) {
    this.latency.add(ms);
  }

  sessionDone(summary: SessionSummary) {
    this.sessions++;
    this.notes += summary.attempted;
    this.clean += summary.clean;
    if (this.done) {
      clearInterval(this.timer);
      this.report();
    }
  }

  report(): SoakReport {
    const report: SoakReport = {
      minutes: Math.round((performance.now() - this.started) / 600) / 100,
      sessions: this.sessions,
      notes: this.notes,
      clean: this.clean,
      latencyP50: Math.round(this.latency.percentile(50)),
      latencyP95: Math.round(this.latency.percentile(95)),
      latencyCount: this.latency.count,
      worstFrameGapMs: Math.round(this.worstGap),
      longFrameGaps: this.longGaps,
      longTasks: this.longTasks,
      hidden: this.hidden,
      heapMB: heapMB(),
      heapStartMB: this.heapStart,
      done: this.done,
    };
    (window as unknown as { __soak: SoakReport }).__soak = report;
    console.info(`[soak]${report.done ? " DONE" : ""} ${JSON.stringify(report)}`);
    return report;
  }
}
