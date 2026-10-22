/** SARIF 2.1.0 export (REPT-3). Used in the sample-data mode; the Reporting service produces the same shape. */
import type { Assessment, Finding } from "../api/types";

const LEVEL = { critical: "error", high: "error", medium: "warning", low: "note" } as const;

export function toSarif(a: Pick<Assessment, "id" | "project_name" | "tools">, findings: Finding[]) {
  const rules = new Map<string, { id: string; name: string; shortDescription: { text: string }; helpUri?: string; properties: object }>();
  for (const f of findings) {
    const id = f.cwe ?? f.id;
    if (!rules.has(id)) {
      rules.set(id, {
        id,
        name: f.title,
        shortDescription: { text: f.title },
        helpUri: f.references[0]?.url,
        properties: { tags: [f.owasp, f.cwe].filter(Boolean) },
      });
    }
  }
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "Securicode",
            informationUri: "https://securicode.local",
            rules: [...rules.values()],
          },
          extensions: a.tools.map((t) => ({ name: t.name, version: t.version })),
        },
        automationDetails: { id: `securicode/${a.project_name}/${a.id}` },
        results: findings.map((f) => ({
          ruleId: f.cwe ?? f.id,
          level: f.status === "false_positive" ? "none" : LEVEL[f.severity],
          kind: f.status === "false_positive" ? "informational" : "fail",
          message: { text: `${f.title}. ${f.explanation}` },
          locations: [{ physicalLocation: { artifactLocation: { uri: f.file }, region: { startLine: f.line, endLine: f.end_line ?? f.line } } }],
          properties: {
            securicodeId: f.id,
            severity: f.severity,
            confidence: f.confidence,
            status: f.status,
            detectedBy: f.detected_by,
            evidence: f.evidence,
            decision: f.decision ?? null,
          },
          ...(f.status === "false_positive" ? { suppressions: [{ kind: "external", justification: f.evidence }] } : {}),
        })),
      },
    ],
  };
}
