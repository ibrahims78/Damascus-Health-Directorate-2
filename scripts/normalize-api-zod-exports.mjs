import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";

const indexPath = fileURLToPath(
  new URL("../lib/api-zod/src/index.ts", import.meta.url),
);

await writeFile(
  indexPath,
  `export type * from "./generated/types";
export * as schemas from "./generated/api";
`,
);