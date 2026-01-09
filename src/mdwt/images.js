const fs = require("fs");
const path = require("path");

module.exports = {
  inlineLocalImages(content, baseDir) {
    if (!content) {
      return content;
    }

    this.imageRegex.lastIndex = 0;
    return content.replace(
      this.imageRegex,
      (match, alt, rawTarget, titleDouble, titleSingle) => {
        const linkTarget = this.normalizeLinkTarget(rawTarget);

        if (!linkTarget || this.isExternalResource(linkTarget)) {
          return match;
        }

        const resolvedPath = path.isAbsolute(linkTarget)
          ? linkTarget
          : path.resolve(baseDir, linkTarget);

        if (!fs.existsSync(resolvedPath)) {
          return match;
        }

        let stats;

        try {
          stats = fs.statSync(resolvedPath);
        } catch (error) {
          return match;
        }

        if (!stats.isFile()) {
          return match;
        }

        let dataUri;

        try {
          const buffer = fs.readFileSync(resolvedPath);
          const mimeType = this.getMimeType(resolvedPath);
          dataUri = `data:${mimeType};base64,${buffer.toString("base64")}`;
        } catch (error) {
          return match;
        }

        const title = titleDouble || titleSingle;
        const titleSegment = title ? ` "${title}"` : "";
        return `![${alt}](${dataUri}${titleSegment})`;
      }
    );
  },

  normalizeLinkTarget(target) {
    if (!target) {
      return "";
    }

    let trimmed = target.trim();

    if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
      trimmed = trimmed.slice(1, -1).trim();
    }

    return trimmed;
  },

  isExternalResource(target) {
    if (!target) {
      return true;
    }

    const lower = target.toLowerCase();

    return (
      lower.startsWith("http://") ||
      lower.startsWith("https://") ||
      lower.startsWith("data:") ||
      lower.startsWith("mailto:") ||
      lower.startsWith("ftp://") ||
      lower.startsWith("//")
    );
  },

  getMimeType(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    const catalog = {
      ".apng": "image/apng",
      ".avif": "image/avif",
      ".bmp": "image/bmp",
      ".gif": "image/gif",
      ".ico": "image/x-icon",
      ".jpeg": "image/jpeg",
      ".jpg": "image/jpeg",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".tif": "image/tiff",
      ".tiff": "image/tiff",
      ".webp": "image/webp",
    };

    return catalog[extension] || "application/octet-stream";
  },
};
