/**
 * 简易 YAML frontmatter 解析。
 *
 * 策略与原 Python `parse_frontmatter` 对齐（朴素，不引入 yaml 依赖）：
 * - 顶层 `key: value` → 标量
 * - `key:` 后跟缩进块 → 原样保留多行文本（permission 等块透传，不做结构化解析）
 *
 * 这是有意简化：本项目的源 frontmatter 只需"按字段透传到目标平台 frontmatter"，
 * 不需要把 permission 解析成对象再序列化回去（那样会丢注释、改顺序）。
 */
export interface Frontmatter {
  [key: string]: string;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n/;
const TOP_KEY_RE = /^[A-Za-z][\w-]*:/;

/** 从 markdown 文本提取 frontmatter 文本；不匹配返回 null。 */
export function extractFrontmatter(text: string): string | null {
  const m = text.match(FRONTMATTER_RE);
  return m ? m[1] : null;
}

/** 从 markdown 文本提取正文（frontmatter 之后的所有内容）。 */
export function extractBody(text: string): string {
  const m = text.match(FRONTMATTER_RE);
  return m ? text.slice(m[0].length) : text;
}

/**
 * 朴素 frontmatter 解析。
 * 顶层 key→value；value 为空时收集后续缩进块为原样多行文本。
 */
export function parseFrontmatter(fmText: string): Frontmatter {
  const result: Frontmatter = {};
  let currentKey: string | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    if (currentKey !== null) {
      result[currentKey] = currentLines.join("\n");
      currentKey = null;
    }
    currentLines = [];
  };

  for (const line of fmText.split(/\r?\n/)) {
    if (TOP_KEY_RE.test(line)) {
      flush();
      const idx = line.indexOf(":");
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      if (val) {
        // 标量值：直接存
        result[key] = val;
        currentKey = null;
        currentLines = [];
      } else {
        // 块值：后续缩进行归到此 key
        currentKey = key;
        currentLines = [];
      }
    } else if (currentKey !== null) {
      currentLines.push(line);
    }
  }
  flush();
  return result;
}

/** 读取 .md 源文件，分离 frontmatter 与正文。 */
export interface ParsedSource {
  frontmatter: Frontmatter;
  body: string;
}

export function parseSource(text: string): ParsedSource {
  const fmText = extractFrontmatter(text);
  return {
    frontmatter: fmText ? parseFrontmatter(fmText) : {},
    body: extractBody(text),
  };
}
