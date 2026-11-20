import JSZip from "jszip";

export interface TextFile {
  fileName: string;
  text: string;
}

/**
 * Reads every .txt file from a ZIP in memory. Works in the browser and in Node.
 * Skips directories, macOS metadata and non-text files. Decodes as UTF-8.
 */
export async function readZipTextFiles(
  data: ArrayBuffer | Uint8Array,
): Promise<{ files: TextFile[]; skipped: string[] }> {
  const zip = await JSZip.loadAsync(data);
  const files: TextFile[] = [];
  const skipped: string[] = [];
  const entries = Object.values(zip.files).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.dir) continue;
    const base = entry.name.split("/").pop() ?? entry.name;
    if (entry.name.startsWith("__MACOSX/") || base.startsWith("._")) {
      skipped.push(entry.name);
      continue;
    }
    if (!/\.txt$/i.test(base)) {
      skipped.push(entry.name);
      continue;
    }
    const bytes = await entry.async("uint8array");
    const text = new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
    files.push({ fileName: base, text });
  }
  return { files, skipped };
}
