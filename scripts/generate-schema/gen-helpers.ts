export class Writer {
  constructor(private buffer: string = "") {}

  append(...t: (string | false | undefined | null | 0)[]) {
    this.buffer += t.filter((t) => t).join(" ");
  }

  appendLine(...t: (string | false | undefined | null | 0)[]) {
    this.append(...t, "\n");
  }

  prepend(...t: (string | false | undefined | null | 0)[]) {
    this.buffer = t.filter((t) => t).join(" ") + this.buffer;
  }

  shorthand() {
    return {
      w: this.append.bind(this),
      wn: this.appendLine.bind(this),
    };
  }

  output() {
    return this.buffer;
  }
}
