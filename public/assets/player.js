/*
 * StepPlayer — the transport bar under every simulator.
 *   ◀◀ first · ◀ back · Play/Pause · ▶ next · ▶▶ last · scrubber with marks · speed · clock
 * onStep(index, info) may return a Promise (an animation); playback waits for it before moving on.
 * Keyboard: Space play/pause, ← → step, Home / End jump (ignored while typing in a field).
 */
(function () {
  "use strict";
  const SPEEDS = [{ v: 0.25, t: "0.25×" }, { v: 0.5, t: "0.5×" }, { v: 1, t: "1×" }, { v: 2, t: "2×" }, { v: 4, t: "4×" }, { v: Infinity, t: "Instant" }];
  const BASE_MS = 1400;

  class StepPlayer {
    constructor(host, opts) {
      this.host = host;
      this.opts = Object.assign({ onStep: () => {}, label: i => "", keyboard: true, storageKey: "speed" }, opts || {});
      this.count = 0; this.i = 0; this.playing = false; this.elapsed = 0; this.token = 0;
      const saved = (window.Studio && Studio.store.get(this.opts.storageKey, 1)) || 1;
      this.speed = saved === 99 ? Infinity : saved;
      if (!SPEEDS.some(s => s.v === this.speed)) this.speed = 1;
      host.classList.add("transport");
      host.innerHTML = `
        <div class="keys" role="group" aria-label="Step controls">
          <button class="btn" data-a="first" title="First step (Home)" aria-label="First step">⏮</button>
          <button class="btn" data-a="prev" title="Previous step (←)" aria-label="Previous step">◀</button>
          <button class="btn primary play" data-a="play" title="Play / pause (Space)">Play</button>
          <button class="btn" data-a="next" title="Next step (→)" aria-label="Next step">▶</button>
          <button class="btn" data-a="last" title="Last step (End)" aria-label="Last step">⏭</button>
        </div>
        <div class="scrub"><input type="range" min="0" max="0" value="0" aria-label="Step"><div class="ticks"></div></div>
        <div class="meta"><span>Step <b class="at">0</b> of <b class="of">0</b></span><span title="Time spent playing">⏱ <span class="clock">0:00.0</span></span></div>
        <div class="speed"><span>Speed</span><div class="seg" role="group" aria-label="Playback speed">${SPEEDS.map(s => `<button type="button" data-speed="${s.v}" aria-pressed="${s.v === this.speed}">${s.t}</button>`).join("")}</div><span class="label muted small"></span></div>`;
      this.range = host.querySelector("input[type=range]");
      this.playBtn = host.querySelector("[data-a=play]");
      host.addEventListener("click", e => {
        const b = e.target.closest("button"); if (!b) return;
        if (b.dataset.speed) return this.setSpeed(+b.dataset.speed);
        const a = b.dataset.a;
        if (a === "play") this.toggle(); else if (a === "prev") this.step(-1); else if (a === "next") this.step(1);
        else if (a === "first") { this.pause(); this.go(0); } else if (a === "last") { this.pause(); this.go(this.count - 1); }
      });
      this.range.addEventListener("input", () => { this.pause(); this.go(+this.range.value); });
      if (this.opts.keyboard) document.addEventListener("keydown", e => {
        if (!this.count || (window.Studio && Studio.typing(e)) || e.altKey || e.ctrlKey || e.metaKey) return;
        if (!this.host.isConnected || this.host.closest("[hidden]")) return;
        if (e.key === " ") { e.preventDefault(); this.toggle(); }
        else if (e.key === "ArrowRight") { e.preventDefault(); this.step(1); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); this.step(-1); }
        else if (e.key === "Home") { e.preventDefault(); this.pause(); this.go(0); }
        else if (e.key === "End") { e.preventDefault(); this.pause(); this.go(this.count - 1); }
      });
      this.tick = this.tick.bind(this);
    }

    /** Reset with a new number of steps. marks: indices to show as ticks (e.g. "new state" steps). */
    load(count, marks, start) {
      this.pause();
      this.count = Math.max(0, count);
      this.elapsed = 0; this.paintClock();
      this.range.max = Math.max(0, this.count - 1);
      const ticks = this.host.querySelector(".ticks");
      ticks.innerHTML = (marks || []).filter(m => m > 0 && m < this.count).slice(0, 400).map(m => `<i style="left:${(m / Math.max(1, this.count - 1)) * 100}%"></i>`).join("");
      this.host.querySelector(".of").textContent = this.count;
      this.go(start == null ? 0 : start, true);
    }

    go(i, silent) {
      if (!this.count) return;
      this.i = Math.max(0, Math.min(this.count - 1, i));
      this.range.value = this.i;
      this.host.querySelector(".at").textContent = this.i + 1;
      this.host.querySelector(".label").textContent = this.opts.label(this.i) || "";
      const res = this.opts.onStep(this.i, { animate: !silent && this.playing, ms: this.stepMs() });
      return res;
    }
    step(d) { this.pause(); this.go(this.i + d); }
    stepMs() { return this.speed === Infinity ? 0 : BASE_MS / this.speed; }
    setSpeed(v) {
      this.speed = v;
      if (window.Studio) Studio.store.set(this.opts.storageKey, v === Infinity ? 99 : v);
      this.host.querySelectorAll("[data-speed]").forEach(b => b.setAttribute("aria-pressed", String((+b.dataset.speed || Infinity) === v)));
    }
    toggle() { this.playing ? this.pause() : this.play(); }
    play() {
      if (!this.count) return;
      if (this.i >= this.count - 1) this.go(0, true);
      this.playing = true; this.playBtn.textContent = "Pause";
      this.lastT = performance.now();
      requestAnimationFrame(this.tick);
      this.loop(++this.token);
    }
    pause() { this.playing = false; this.token++; if (this.playBtn) this.playBtn.textContent = "Play"; }
    async loop(token) {
      while (this.playing && token === this.token) {
        const ms = this.stepMs();
        const started = performance.now();
        await new Promise(r => setTimeout(r, ms === 0 ? 120 : Math.max(120, ms * 0.35)));
        if (!this.playing || token !== this.token) return;
        if (this.i >= this.count - 1) { this.pause(); return; }
        await Promise.resolve(this.go(this.i + 1));
        const rest = (ms === 0 ? 120 : ms) - (performance.now() - started);
        if (rest > 0) await new Promise(r => setTimeout(r, rest * 0.5));
      }
    }
    tick(now) {
      if (!this.playing) return;
      this.elapsed += now - this.lastT; this.lastT = now;
      this.paintClock();
      requestAnimationFrame(this.tick);
    }
    paintClock() {
      const s = this.elapsed / 1000, m = Math.floor(s / 60);
      this.host.querySelector(".clock").textContent = `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
    }
  }
  StepPlayer.SPEEDS = SPEEDS;
  window.StepPlayer = StepPlayer;
})();
