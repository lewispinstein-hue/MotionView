export class LiveConsoleBuffer {
  private queue: string[] = [];
  private scheduled = false;
  private raw = "";

  constructor(
    private readonly target: HTMLElement | null,
    private readonly maxChars = 50_000,
    private readonly maxLines = 2000,
  ) {}

  appendLine(value: string) {
    if (!this.target) return;
    const trimmed = (value.endsWith("\n") || value.endsWith("\r\n")) ? value : `${value}\n`;
    this.queue.push(trimmed);
    if (!this.scheduled) {
      this.scheduled = true;
      requestAnimationFrame(() => this.flush());
    }
  }

  reset() {
    this.raw = "";
    this.queue = [];
    if (this.target) this.target.innerHTML = "";
  }

  private flush() {
    this.scheduled = false;
    if (!this.target || this.queue.length === 0) return;

    const nearBottom =
      this.target.scrollTop + this.target.clientHeight >= this.target.scrollHeight - 12;

    this.raw += this.queue.join("");
    this.queue = [];

    if (this.raw.length > this.maxChars) {
      this.raw = this.raw.slice(this.raw.length - this.maxChars);
    }

    const lines = this.raw.split("\n");
    if (lines.length > this.maxLines) {
      this.raw = lines.slice(lines.length - this.maxLines).join("\n");
    }

    this.target.innerHTML = ansiToHtml(this.raw);
    if (nearBottom) this.target.scrollTop = this.target.scrollHeight;
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/"/g, "&#39;");
}

export function ansiToHtml(text: string) {
  const fg: Record<number, string> = {
    30: "#000000", 31: "#d9534f", 32: "#5cb85c", 33: "#f0ad4e",
    34: "#5bc0de", 35: "#c678dd", 36: "#46b8da", 37: "#e9eef7",
    90: "#8a8f98", 91: "#ff6b6b", 92: "#6dd96c", 93: "#ffd66b",
    94: "#63b3ff", 95: "#e09bff", 96: "#76e4f7", 97: "#f8fbff",
  };
  const bg: Record<number, string> = {
    40: "#000000", 41: "#d9534f", 42: "#5cb85c", 43: "#f0ad4e",
    44: "#5bc0de", 45: "#c678dd", 46: "#46b8da", 47: "#e9eef7",
    100: "#2b2d31", 101: "#ff6b6b", 102: "#6dd96c", 103: "#ffd66b",
    104: "#63b3ff", 105: "#e09bff", 106: "#76e4f7", 107: "#f8fbff",
  };

  let cur: { fg: string | null; bg: string | null; bold: boolean } = { fg: null, bg: null, bold: false };
  let out = "";
  let last = 0;
  const re = /\u001b\[(\d+(?:;\d+)*)m/g;

  function span(txt: string, style: typeof cur) {
    if (!txt) return "";
    const body = escapeHtml(txt).replace(/\n/g, "<br>");
    const css = [];
    if (style.bold) css.push("font-weight:700");
    if (style.fg) css.push(`color:${style.fg}`);
    if (style.bg) css.push(`background-color:${style.bg}`);
    if (!css.length) return body;
    return `<span style="${css.join(";")}">${body}</span>`;
  }

  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const chunk = text.slice(last, match.index);
    out += span(chunk, cur);
    last = re.lastIndex;
    const codes = match[1].split(";").map((n) => Number(n) || 0);
    for (const code of codes) {
      if (code === 0) { cur = { fg: null, bg: null, bold: false }; continue; }
      if (code === 1) { cur.bold = true; continue; }
      if (fg[code]) { cur.fg = fg[code]; continue; }
      if (bg[code]) { cur.bg = bg[code]; continue; }
    }
  }
  out += span(text.slice(last), cur);
  return out;
}
