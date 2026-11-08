import { timing } from "../dist/http.js";

class FakeClock {
  constructor() {
    this.skipped = 0;
    this.pending = new Set();
    this.waiting = [];
    this.real = { ...timing };
  }

  now() {
    return Date.now() + this.skipped;
  }

  pause(ms) {
    this.advance(ms);
    return 0;
  }

  timer(fn, ms) {
    const t = { at: this.now() + ms, fn };
    t.backstop = setTimeout(() => this.fire(t), ms);
    this.pending.add(t);
    for (const resolve of this.waiting.splice(0)) resolve(t);
    return () => {
      this.pending.delete(t);
      clearTimeout(t.backstop);
    };
  }

  fire(t) {
    if (!this.pending.delete(t)) return;
    clearTimeout(t.backstop);
    t.fn();
  }

  advance(ms) {
    this.skipped += Math.max(0, ms);
    const now = this.now();
    for (const t of [...this.pending].sort((a, b) => a.at - b.at)) if (t.at <= now) this.fire(t);
  }

  skipTo(t) {
    this.advance(t.at - this.now());
  }

  skipToNextTimer() {
    const [next] = [...this.pending].sort((a, b) => a.at - b.at);
    if (next) this.skipTo(next);
  }

  nextTimer() {
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  install() {
    timing.now = () => this.now();
    timing.pause = (ms) => this.pause(ms);
    timing.timer = (fn, ms) => this.timer(fn, ms);
  }

  async onRealTime(fn) {
    Object.assign(timing, this.real);
    try {
      return await fn();
    } finally {
      this.install();
    }
  }
}

const CLOCK = new FakeClock();
CLOCK.install();

export { CLOCK };
