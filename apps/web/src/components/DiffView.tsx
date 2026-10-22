import { parseDiff } from "../lib/diff";

/** Unified diff with both line-number gutters and a +/− marker column, so changes don't rely on colour alone. */
export function DiffView({ diff }: { diff: string }) {
  const files = parseDiff(diff);
  return (
    <div className="stack">
      {files.map((f, i) => (
        <figure key={i} className="diff" style={{ margin: 0 }}>
          <figcaption className="diff-head">
            <span>{f.newPath || f.oldPath}</span>
            <span><span className="sr-only">lines </span>+{f.added} −{f.removed}</span>
          </figcaption>
          <pre aria-label={`Changes to ${f.newPath || f.oldPath}`}>
            {f.lines.map((l, j) =>
              l.kind === "hunk" ? (
                <div key={j} className="ln hunk"><span className="no" /><span className="no" /><span className="mk" /><span>{l.text}</span></div>
              ) : (
                <div key={j} className={`ln ${l.kind === "add" ? "add" : l.kind === "del" ? "del" : ""}`}>
                  <span className="no">{l.oldNo ?? ""}</span>
                  <span className="no">{l.newNo ?? ""}</span>
                  <span className="mk">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : ""}<span className="sr-only">{l.kind === "add" ? " added" : l.kind === "del" ? " removed" : ""}</span></span>
                  <span>{l.text || " "}</span>
                </div>
              ),
            )}
          </pre>
        </figure>
      ))}
    </div>
  );
}
