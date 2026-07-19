/**
 * 测试共享工具。
 *
 * 集中放跨测试文件复用的纯函数，避免重复定义。
 */
import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** 递归复制目录。 */
export function copyDir(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dest, entry);
    const st = statSync(s);
    if (st.isDirectory()) {
      copyDir(s, d);
    } else {
      copyFileSync(s, d);
    }
  }
}
