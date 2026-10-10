import fs from "node:fs";
import path from "node:path";
import { storageDir } from "./paths";
import type { BlockEvent } from "../shared/types";

export const VARIANTS = ["dual", "mono"] as const;
export type Variant = (typeof VARIANTS)[number];

function ensure(): void {
  fs.mkdirSync(storageDir(), { recursive: true });
}

export function indexPath(): string {
  ensure();
  return path.join(storageDir(), "index.json");
}

export function docDir(id: string): string {
  return path.join(storageDir(), id);
}

export function sourceFile(id: string): string {
  return path.join(docDir(id), "paper.pdf");
}

export function variantFile(id: string, cacheKey: string, variant: string): string {
  return path.join(docDir(id), cacheKey + "." + variant + ".pdf");
}

export function blocksFile(id: string, cacheKey: string): string {
  return path.join(docDir(id), cacheKey + ".blocks.jsonl");
}

export function ensureDocDir(id: string): void {
  fs.mkdirSync(docDir(id), { recursive: true });
}

export function saveTranslation(
  id: string,
  cacheKey: string,
  files: Partial<Record<Variant, string>>,
  blocksSource?: string | null
): string[] {
  const saved: string[] = [];
  for (const variant of VARIANTS) {
    const source = files[variant];
    if (!source || !fs.existsSync(source)) {
      continue;
    }
    ensureDocDir(id);
    fs.copyFileSync(source, variantFile(id, cacheKey, variant));
    saved.push(variant);
  }
  if (blocksSource && fs.existsSync(blocksSource)) {
    try {
      ensureDocDir(id);
      fs.copyFileSync(blocksSource, blocksFile(id, cacheKey));
    } catch {
      // best effort
    }
  }
  return saved;
}

export function readTranslation(id: string, cacheKey: string, variant?: string): Buffer | null {
  const file = variantFile(id, cacheKey, variant || "dual");
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}

export function hasTranslation(id: string, cacheKey: string, variant?: string): boolean {
  return fs.existsSync(variantFile(id, cacheKey, variant || "dual"));
}

export function readBlocks(id: string, cacheKey: string): BlockEvent[] {
  const file = blocksFile(id, cacheKey);
  const blocks: BlockEvent[] = [];
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return blocks;
  }
  for (const line of raw.split("\n")) {
    const text = line.trim();
    if (!text) {
      continue;
    }
    try {
      blocks.push(JSON.parse(text) as BlockEvent);
    } catch {
      // skip malformed line
    }
  }
  return blocks;
}

export function removeTranslation(id: string, cacheKey: string): void {
  for (const variant of VARIANTS) {
    const file = variantFile(id, cacheKey, variant);
    if (fs.existsSync(file)) {
      fs.rmSync(file, { force: true });
    }
  }
  const blocks = blocksFile(id, cacheKey);
  if (fs.existsSync(blocks)) {
    fs.rmSync(blocks, { force: true });
  }
}

export function removeDocDir(id: string): void {
  const dir = docDir(id);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
