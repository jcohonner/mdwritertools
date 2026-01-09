module.exports = {
  extractFrontMatter(content) {
    let working = content;
    let bom = "";

    if (working.startsWith("\uFEFF")) {
      bom = "\uFEFF";
      working = working.slice(1);
    }

    if (!working.startsWith("---\n") && !working.startsWith("---\r\n")) {
      return { body: content, vars: {}, frontMatterRaw: null };
    }

    const match = working.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);

    if (!match) {
      return { body: content, vars: {}, frontMatterRaw: null };
    }

    const frontMatterBlock = match[0];
    const frontMatterContent = match[1] || "";
    const rest = working.slice(frontMatterBlock.length);
    let removedNewline = "";

    if (rest.startsWith("\r\n")) {
      removedNewline = "\r\n";
    } else if (rest.startsWith("\n")) {
      removedNewline = "\n";
    }

    const body = rest.slice(removedNewline.length);
    const frontMatterRaw = bom + frontMatterBlock + removedNewline;
    const vars = this.parseFrontMatterVars(frontMatterContent);

    return {
      body,
      vars,
      frontMatterRaw,
    };
  },

  parseFrontMatterVars(block) {
    const vars = {};
    const lines = block.split(/\r?\n/);
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (!line || !line.trim()) {
        i += 1;
        continue;
      }

      const separatorIndex = line.indexOf(":");

      if (separatorIndex === -1) {
        i += 1;
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      const rawValue = line.slice(separatorIndex + 1).trim();

      if (!key) {
        i += 1;
        continue;
      }

      if (rawValue) {
        vars[key] = this.normalizeFrontMatterValue(rawValue);
        i += 1;
        continue;
      }

      const listItems = [];
      let j = i + 1;

      while (j < lines.length) {
        const listLine = lines[j];

        if (!listLine || !listLine.trim()) {
          j += 1;
          continue;
        }

        if (!/^\s+-\s+/.test(listLine)) {
          break;
        }

        const item = listLine.replace(/^\s+-\s+/, "");
        listItems.push(this.normalizeFrontMatterValue(item));
        j += 1;
      }

      if (listItems.length) {
        vars[key] = listItems;
        i = j;
        continue;
      }

      vars[key] = "";
      i += 1;
    }

    return vars;
  },

  normalizeFrontMatterValue(value) {
    if (!value) {
      return "";
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      return value.slice(1, -1);
    }

    return value;
  },

  renderFrontMatterBlock(rootVariables = {}, frontMatterRaw = null) {
    const keys = Object.keys(rootVariables || {});

    if (!keys.length) {
      return frontMatterRaw || "";
    }

    const newline = this.detectNewline(frontMatterRaw);
    const bom =
      frontMatterRaw && frontMatterRaw.startsWith("\uFEFF") ? "\uFEFF" : "";
    const lines = [];

    keys.sort().forEach((key) => {
      const value = rootVariables[key];

      if (Array.isArray(value)) {
        lines.push(`${key}:`);
        value.forEach((item) => {
          lines.push(`  - ${item}`);
        });
        return;
      }

      lines.push(`${key}: ${value}`);
    });

    return `${bom}---${newline}${lines.join(newline)}${newline}---${newline}${newline}`;
  },

  detectNewline(sample) {
    if (!sample) {
      return "\n";
    }

    return sample.includes("\r\n") ? "\r\n" : "\n";
  },
};
