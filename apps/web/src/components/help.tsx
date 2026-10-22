/** Context-sensitive help (SRS 2.6, 3.1: every page provides access to help). */
import type { ReactNode } from "react";
import { SeverityBadge } from "./ui";

interface Topic { title: string; body: ReactNode }

const severityGuide = (
  <>
    <h3>Severity and confidence</h3>
    <p className="small">Severity is how much damage an issue could cause if it is real. Confidence is how sure the AI agent is that it is real. Fix high-severity, high-confidence issues first.</p>
    <ul className="small">
      <li><SeverityBadge level="critical" /> can be exploited now with serious impact, such as a live key in the code.</li>
      <li><SeverityBadge level="high" /> lets an attacker read or change data.</li>
      <li><SeverityBadge level="medium" /> weakens security or needs other conditions to exploit.</li>
      <li><SeverityBadge level="low" /> worth fixing, little direct impact.</li>
    </ul>
  </>
);

const TOPICS: { match: RegExp; topic: Topic }[] = [
  {
    match: /^\/assessments\/[^/]+\/report/,
    topic: { title: "Printable report", body: <p className="small">Use your browser's Print command and choose "Save as PDF" to keep a copy. The report lists every confirmed finding with its explanation and fix.</p> },
  },
  {
    match: /^\/assessments\//,
    topic: {
      title: "Reviewing findings",
      body: (
        <>
          <p className="small">Scanners raise alerts, the AI agent checks each one against your code, and you make the final decision. Nothing in your code changes until you approve a fix.</p>
          <h3>What you can do with a finding</h3>
          <ul className="small">
            <li><b>Approve fix</b> records your approval and downloads the change as a patch file you apply with <code>git apply</code>.</li>
            <li><b>Reject fix</b> keeps the finding open but records that the proposed change is not suitable.</li>
            <li><b>Mark false positive</b> moves the finding to the Dismissed tab. Add a comment so others know why.</li>
            <li><b>Ask about this</b> opens the assistant with this finding as context. It explains, but it never changes files.</li>
          </ul>
          <h3>Dismissed findings</h3>
          <p className="small">Alerts the agent judged to be false alarms are kept, with its reasoning, under Dismissed. If you disagree, choose Treat as real issue.</p>
          {severityGuide}
          <h3>Keyboard</h3>
          <p className="small"><kbd>j</kbd> and <kbd>k</kbd> move through the list. <kbd>?</kbd> opens this help.</p>
        </>
      ),
    },
  },
  {
    match: /^\/projects\/[^/]+\/compare/,
    topic: { title: "Comparing assessments", body: <p className="small">New findings appeared in the later assessment. Resolved findings were in the earlier one and are gone now, usually because a fix was applied. Unchanged findings are in both.</p> },
  },
  {
    match: /^\/projects\//,
    topic: {
      title: "Project history",
      body: (
        <>
          <p className="small">Every assessment of this project is kept. Run a new assessment after applying fixes to see what was resolved, then compare the two.</p>
          <p className="small">For a connected repository, a new assessment fetches the latest commit of the selected branch. For a ZIP project, upload a new archive to assess newer code.</p>
        </>
      ),
    },
  },
  {
    match: /^\/account/,
    topic: {
      title: "Your account",
      body: (
        <>
          <h3>Git access tokens</h3>
          <p className="small">Securicode needs a token to read private repositories. Create one with read-only repository access: on GitHub a fine-grained token with Contents: read; on GitLab a personal access token with the read_repository scope. Tokens are checked with the provider, stored encrypted and only shown masked.</p>
          <h3>Sessions</h3>
          <p className="small">You are signed out after 60 minutes without activity, and after 12 hours in any case.</p>
          <h3>Activity</h3>
          <p className="small">Sign-ins, decisions on findings and changes to your account are recorded and cannot be edited.</p>
        </>
      ),
    },
  },
  {
    match: /^\/admin/,
    topic: {
      title: "Administration",
      body: (
        <>
          <p className="small">Only administrators see this area. Deactivating an account signs that person out immediately; their data is kept until the account is reactivated or deleted.</p>
          <p className="small">The daily assessment limit applies to each user (administrators are exempt). System status shows whether the gateway can reach each backend service.</p>
        </>
      ),
    },
  },
  {
    match: /.*/,
    topic: {
      title: "Getting started",
      body: (
        <>
          <p className="small">Securicode checks a project's source code for security problems, explains each one in plain language and proposes a fix you can approve.</p>
          <h3>Start an assessment</h3>
          <ul className="small">
            <li><b>Upload ZIP</b>: a ZIP of your project, up to 100 MB. Leave out node_modules and virtual environments.</li>
            <li><b>Connect repository</b>: a GitHub or GitLab URL and branch. Private repositories need an access token, added under Account.</li>
          </ul>
          <p className="small">You need a verified e-mail address before you can run assessments. Most assessments finish within 30 minutes; you can leave the page and come back.</p>
          {severityGuide}
          <h3>In VS Code</h3>
          <p className="small">Install the Securicode extension and choose Sign in. Results are the same in the editor and here.</p>
        </>
      ),
    },
  },
];

export function helpFor(path: string): Topic {
  return TOPICS.find((t) => t.match.test(path))!.topic;
}
