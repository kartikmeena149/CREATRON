// The render's progress: in a terminal, one line that redraws (bar, percent, frames, speed, time
// left); when the output goes to a file or the AI, a plain line every 5%.
export function progressBar(total: number, fps: number) {
  const tty = process.stdout.isTTY;
  const began = Date.now();
  let from = 0; // frames already there from an earlier try: not counted for the speed
  let lastStep = -1;
  let lastDraw = 0;
  const clock = (ms: number) => {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  const line = (at: number) => {
    const f = Math.min(1, at / total);
    const made = at - from;
    const spent = Date.now() - began;
    const left = f >= 1 ? "done" : made > fps ? `${clock((spent / made) * (total - at))} left` : "--:-- left";
    const speed = made > 0 ? (made / (spent / 1000)).toFixed(1) : "0.0";
    const tail = ` ${String(Math.floor(f * 100)).padStart(3)}%  ${Math.floor(at)}/${total}  ${speed} fps  ${left}`;
    // The bar takes what the window leaves: a wrapped line would start a new line at every redraw.
    const cols = process.stdout.columns || 80;
    const width = Math.max(0, Math.min(28, cols - tail.length - 4));
    const fill = Math.round(f * width);
    return (width >= 5 ? `[${"█".repeat(fill)}${"░".repeat(width - fill)}]${tail}` : tail.trim()).slice(0, cols - 1);
  };
  const show = (at: number) => {
    if (tty) {
      if (Date.now() - lastDraw < 150 && at < total) return;
      lastDraw = Date.now();
      process.stdout.write(`\r\x1b[K${line(at)}`);
    } else {
      const step = Math.floor((at / total) * 20);
      if (step === lastStep) return;
      lastStep = step;
      console.log(line(at));
    }
  };
  return {
    show,
    /** Pieces kept from an earlier try. */
    skip(at: number) {
      from = at;
      show(at);
    },
    /** A message, without breaking the bar. */
    say(text: string) {
      if (tty) process.stdout.write("\r\x1b[K");
      console.log(text);
    },
    end() {
      if (tty) process.stdout.write("\n");
    },
  };
}
