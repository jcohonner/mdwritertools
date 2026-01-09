module.exports = {
  prettifyMarkdown(content) {
    if (!content) {
      return "";
    }

    const normalized = content.replace(/\r\n/g, "\n");
    const trimmedTrailingSpaces = normalized
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n");
    const collapsed = this.collapseBlankLines(trimmedTrailingSpaces);
    const withoutTrailingBlankLines = collapsed.replace(/\n+$/g, "\n");

    if (withoutTrailingBlankLines.endsWith("\n")) {
      return withoutTrailingBlankLines;
    }

    return `${withoutTrailingBlankLines}\n`;
  },

  collapseBlankLines(content) {
    const lines = content.split("\n");
    const result = [];
    let inFence = false;
    let fenceChar = null;
    let fenceLength = 0;
    let previousBlank = false;

    lines.forEach((line) => {
      const trimmed = line.trim();

      if (inFence) {
        if (this.startsWithFence(trimmed, fenceChar, fenceLength)) {
          inFence = false;
          fenceChar = null;
          fenceLength = 0;
        }

        result.push(line);
        previousBlank = false;
        return;
      }

      const fenceInfo = this.getFenceInfo(trimmed);

      if (fenceInfo) {
        inFence = true;
        fenceChar = fenceInfo.char;
        fenceLength = fenceInfo.length;
        result.push(line);
        previousBlank = false;
        return;
      }

      const isBlank = trimmed === "";

      if (isBlank && previousBlank) {
        return;
      }

      result.push(line);
      previousBlank = isBlank;
    });

    return result.join("\n");
  },
};
