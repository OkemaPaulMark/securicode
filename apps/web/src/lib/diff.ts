/** Minimal unified-diff parser for display. Keeps old/new line numbers so the viewer can show both gutters. */
export type DiffLineKind = "add" | "del" | "ctx" | "hunk";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

export interface DiffFile {
  oldPath: string;
  newPath: string;
  lines: DiffLine[];
  added: number;
  removed: number;
}

export function parseDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let cur: DiffFile | null = null;
  let oldNo = 0;
  let newNo = 0;
  const lines = diff.replace(/\r\n/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();

  for (const raw of lines) {
    if (raw.startsWith("--- ")) {
      cur = { oldPath: strip(raw.slice(4)), newPath: "", lines: [], added: 0, removed: 0 };
      files.push(cur);
      continue;
    }
    if (raw.startsWith("+++ ") && cur && !cur.newPath) {
      cur.newPath = strip(raw.slice(4));
      continue;
    }
    if (!cur) {
      cur = { oldPath: "", newPath: "", lines: [], added: 0, removed: 0 };
      files.push(cur);
    }
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw);
    if (m) {
      oldNo = Number(m[1]);
      newNo = Number(m[2]);
      cur.lines.push({ kind: "hunk", text: raw, oldNo: null, newNo: null });
    } else if (raw.startsWith("+")) {
      cur.lines.push({ kind: "add", text: raw.slice(1), oldNo: null, newNo: newNo++ });
      cur.added++;
    } else if (raw.startsWith("-")) {
      cur.lines.push({ kind: "del", text: raw.slice(1), oldNo: oldNo++, newNo: null });
      cur.removed++;
    } else if (raw.startsWith("\\")) {
      continue; // "\ No newline at end of file"
    } else {
      cur.lines.push({ kind: "ctx", text: raw.startsWith(" ") ? raw.slice(1) : raw, oldNo: oldNo++, newNo: newNo++ });
    }
  }
  return files;
}

function strip(path: string): string {
  return path.replace(/^[ab]\//, "").replace(/\t.*$/, "").trim();
}

/** Joins several findings' diffs into one patch file (REV-7). */
export function joinPatches(diffs: { id: string; title: string; diff: string }[]): string {
  return diffs.map((d) => `# ${d.id}: ${d.title}\n${d.diff.endsWith("\n") ? d.diff : d.diff + "\n"}`).join("\n");
}
