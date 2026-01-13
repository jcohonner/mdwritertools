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

  stripHtmlComments(content) {
    if (!content) {
      return content;
    }

    const lines = content.split(/\r?\n/);
    const result = [];
    let inFence = false;
    let fenceChar = null;
    let fenceLength = 0;
    let inComment = false;

    lines.forEach((line) => {
      if (inFence) {
        const trimmed = line.trim();

        if (this.startsWithFence(trimmed, fenceChar, fenceLength)) {
          inFence = false;
          fenceChar = null;
          fenceLength = 0;
        }

        result.push(line);
        return;
      }

      let output = "";
      let cursor = 0;
      let removed = false;

      while (cursor < line.length) {
        if (inComment) {
          const endIndex = line.indexOf("-->", cursor);

          if (endIndex === -1) {
            removed = true;
            cursor = line.length;
            break;
          }

          cursor = endIndex + 3;
          inComment = false;
          removed = true;
          continue;
        }

        const startIndex = line.indexOf("<!--", cursor);

        if (startIndex === -1) {
          output += line.slice(cursor);
          break;
        }

        output += line.slice(cursor, startIndex);
        cursor = startIndex + 4;
        inComment = true;
        removed = true;
      }

      if (output === "" && removed) {
        return;
      }

      const outputTrimmed = output.trim();
      const fenceInfo = this.getFenceInfo(outputTrimmed);

      if (fenceInfo && !inComment) {
        inFence = true;
        fenceChar = fenceInfo.char;
        fenceLength = fenceInfo.length;
      }

      result.push(output);
    });

    return result.join("\n");
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
