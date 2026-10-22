/** Inline icons (stroke-based, 20px grid). Decorative unless given a title. */
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  );
}

export const Logo = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <rect width="32" height="32" rx="8" fill="var(--accent)" />
    <path d="M12 9.5 7.5 16l4.5 6.5M20 9.5l4.5 6.5-4.5 6.5" fill="none" stroke="var(--on-accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="m13 16.4 2.2 2.2 4-4.6" fill="none" stroke="var(--on-accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconHome = (p: P) => <Svg {...p}><path d="M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-3.5v-4.5h-5V17H4a1 1 0 0 1-1-1z" /></Svg>;
export const IconFolder = (p: P) => <Svg {...p}><path d="M2.5 6a1.5 1.5 0 0 1 1.5-1.5h3.6l1.8 2H16A1.5 1.5 0 0 1 17.5 8v7a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 15z" /></Svg>;
export const IconUser = (p: P) => <Svg {...p}><circle cx="10" cy="7" r="3.2" /><path d="M3.8 17c.8-3 3.3-4.6 6.2-4.6s5.4 1.6 6.2 4.6" /></Svg>;
export const IconShield = (p: P) => <Svg {...p}><path d="M10 2.8 16 5v4.6c0 3.7-2.6 6.4-6 7.6-3.4-1.2-6-3.9-6-7.6V5z" /><path d="m7.4 10 1.8 1.8 3.5-3.6" /></Svg>;
export const IconUpload = (p: P) => <Svg {...p}><path d="M10 13V3.5M6.2 7.2 10 3.5l3.8 3.7M3.5 13.5V16h13v-2.5" /></Svg>;
export const IconBranch = (p: P) => <Svg {...p}><circle cx="6" cy="4.5" r="1.8" /><circle cx="6" cy="15.5" r="1.8" /><circle cx="14" cy="6.5" r="1.8" /><path d="M6 6.3v7.4M14 8.3c0 3.2-3.6 3-6.6 5.6" /></Svg>;
export const IconHelp = (p: P) => <Svg {...p}><circle cx="10" cy="10" r="7.3" /><path d="M7.9 7.6a2.2 2.2 0 1 1 3.1 2c-.6.3-1 .8-1 1.5v.4" /><circle cx="10" cy="14.2" r=".4" fill="currentColor" /></Svg>;
export const IconMenu = (p: P) => <Svg {...p}><path d="M3.5 6h13M3.5 10h13M3.5 14h13" /></Svg>;
export const IconClose = (p: P) => <Svg {...p}><path d="m5 5 10 10M15 5 5 15" /></Svg>;
export const IconSun = (p: P) => <Svg {...p}><circle cx="10" cy="10" r="3.4" /><path d="M10 2.5v1.6M10 15.9v1.6M2.5 10h1.6M15.9 10h1.6M4.7 4.7l1.1 1.1M14.2 14.2l1.1 1.1M4.7 15.3l1.1-1.1M14.2 5.8l1.1-1.1" /></Svg>;
export const IconMoon = (p: P) => <Svg {...p}><path d="M16 12.2A6.6 6.6 0 0 1 7.8 4a6.6 6.6 0 1 0 8.2 8.2z" /></Svg>;
export const IconChat = (p: P) => <Svg {...p}><path d="M3.5 5.5A1.5 1.5 0 0 1 5 4h10a1.5 1.5 0 0 1 1.5 1.5v6.5A1.5 1.5 0 0 1 15 13.5H9l-3.6 3v-3H5A1.5 1.5 0 0 1 3.5 12z" /></Svg>;
export const IconDownload = (p: P) => <Svg {...p}><path d="M10 3.5V13M6.2 9.3 10 13l3.8-3.7M3.5 14v2.5h13V14" /></Svg>;
export const IconCheck = (p: P) => <Svg {...p}><path d="m4.5 10.5 3.6 3.6 7.4-8" /></Svg>;
export const IconX = (p: P) => <Svg {...p}><path d="m6 6 8 8M14 6l-8 8" /></Svg>;
export const IconRefresh = (p: P) => <Svg {...p}><path d="M15.8 8.5A6 6 0 0 0 4.6 7M4.2 11.5A6 6 0 0 0 15.4 13" /><path d="M4.3 3.8V7h3.2M15.7 16.2V13h-3.2" /></Svg>;
export const IconTrash = (p: P) => <Svg {...p}><path d="M4 6h12M8 6V4.2h4V6M5.5 6l.7 10h7.6l.7-10" /></Svg>;
export const IconFile = (p: P) => <Svg {...p}><path d="M5 2.8h6.5L15 6.3v10.9H5z" /><path d="M11.3 2.8v3.6H15" /></Svg>;
export const IconKey = (p: P) => <Svg {...p}><circle cx="6.5" cy="13.5" r="3" /><path d="m8.6 11.4 7-7M13 7l2 2M11.3 8.7l1.6 1.6" /></Svg>;
export const IconCompare = (p: P) => <Svg {...p}><path d="M7 3.5v13M13 3.5v13M3.5 7h3.5M13 13h3.5" /></Svg>;
export const IconAlert = (p: P) => <Svg {...p}><path d="M10 3 17.5 16h-15z" /><path d="M10 8v3.6" /><circle cx="10" cy="13.8" r=".4" fill="currentColor" /></Svg>;
export const IconGear = (p: P) => <Svg {...p}><circle cx="10" cy="10" r="2.6" /><path d="M10 2.8v2M10 15.2v2M2.8 10h2M15.2 10h2M4.9 4.9l1.4 1.4M13.7 13.7l1.4 1.4M4.9 15.1l1.4-1.4M13.7 6.3l1.4-1.4" /></Svg>;
export const IconLogout = (p: P) => <Svg {...p}><path d="M8 4H4.5v12H8M12 6.5 15.5 10 12 13.5M15.5 10H7.5" /></Svg>;
export const IconStop = (p: P) => <Svg {...p}><rect x="5" y="5" width="10" height="10" rx="1.5" /></Svg>;
export const IconExternal = (p: P) => <Svg {...p} size={p.size ?? 14}><path d="M11 3.5h5.5V9M16.5 3.5 9 11M14 12v4.5H3.5V6H8" /></Svg>;
export const IconGithub = (p: P) => (
  <svg width={p.size ?? 14} height={p.size ?? 14} viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="currentColor">
    <path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.23.83 1.23.83.71 1.22 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0" />
  </svg>
);
export const IconGitlab = (p: P) => (
  <svg width={p.size ?? 14} height={p.size ?? 14} viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="currentColor">
    <path d="m15.73 6.34-.02-.06-2.12-5.55a.55.55 0 0 0-1.05.06l-1.43 4.38H4.89L3.46.79a.55.55 0 0 0-1.05-.06L.29 6.28l-.02.06a3.94 3.94 0 0 0 1.3 4.55l.01.01.03.02 3.24 2.43 1.6 1.21.98.74a.66.66 0 0 0 .8 0l.98-.74 1.6-1.21 3.27-2.45.01-.01a3.94 3.94 0 0 0 1.3-4.55" />
  </svg>
);

/** Severity shapes, so severity is never shown by colour alone (SRS 3.1). */
export function SeverityShape({ level }: { level: "critical" | "high" | "medium" | "low" }) {
  const common = { width: 10, height: 10, viewBox: "0 0 10 10", "aria-hidden": true as const, focusable: false as const };
  if (level === "critical") return <svg {...common}><path d="M5 .5 9.5 5 5 9.5.5 5z" fill="currentColor" /></svg>;
  if (level === "high") return <svg {...common}><path d="M5 1 9.4 9H.6z" fill="currentColor" /></svg>;
  if (level === "medium") return <svg {...common}><rect x="1.2" y="1.2" width="7.6" height="7.6" rx="1" fill="currentColor" /></svg>;
  return <svg {...common}><circle cx="5" cy="5" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>;
}
