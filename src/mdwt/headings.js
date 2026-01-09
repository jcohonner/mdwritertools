module.exports = {
  getHeadingLevel(line) {
    const match = line.trim().match(/^(#{1,6})\s+/);
    return match ? match[1].length : null;
  },

  detectLowestHeadingLevel(content) {
    const lines = content.split(/\r?\n/);
    let minLevel = null;

    for (const line of lines) {
      const level = this.getHeadingLevel(line);

      if (level && (minLevel === null || level < minLevel)) {
        minLevel = level;
      }
    }

    return minLevel;
  },

  parseLevelSpec(spec) {
    if (!spec) return null;
    const trimmed = spec.trim();

    if (!/^#{1,6}$/.test(trimmed)) {
      return null;
    }

    return trimmed.length;
  },

  shiftHeadingLevels(content, shift) {
    const lines = content.split(/\r?\n/);
    let inFence = false;
    let fenceChar = null;
    let fenceLength = 0;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const trimmed = line.trim();

      if (inFence) {
        if (this.startsWithFence(trimmed, fenceChar, fenceLength)) {
          inFence = false;
          fenceChar = null;
          fenceLength = 0;
        }

        continue;
      }

      const fenceInfo = this.getFenceInfo(trimmed);

      if (fenceInfo) {
        inFence = true;
        fenceChar = fenceInfo.char;
        fenceLength = fenceInfo.length;
        continue;
      }

      const match = line.match(/^(\s{0,3})(#{1,6})(\s+)(.*)$/);

      if (!match) {
        continue;
      }

      const [, indent, hashes, space, rest] = match;
      const currentLevel = hashes.length;
      let nextLevel = currentLevel + shift;

      nextLevel = Math.max(1, Math.min(6, nextLevel));
      lines[i] = `${indent}${"#".repeat(nextLevel)}${space}${rest}`;
    }

    return lines.join("\n");
  },

  getFenceInfo(trimmedLine) {
    const match = trimmedLine.match(/^(\`\`\`+|~~~+)/);
    if (!match) {
      return null;
    }

    return {
      char: match[0][0],
      length: match[0].length,
    };
  },

  startsWithFence(trimmedLine, fenceChar, fenceLength) {
    if (!fenceChar || fenceLength <= 0) {
      return false;
    }

    return trimmedLine.startsWith(fenceChar.repeat(fenceLength));
  },
};
