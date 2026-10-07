// node:fs 空桩。provider-env.ts 仅在 Bun 沙箱环境的分支里 require("node:fs"),
// 浏览器环境 typeof process === "undefined",该分支永不触发,此桩只为让打包解析通过。
export function readFileSync(): string {
  return "";
}
export default { readFileSync };
