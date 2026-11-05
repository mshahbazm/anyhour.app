import type { ReactElement } from "react";
import { launcherIcons, whatsappIcon } from "./iconPaths";
import type { tLauncherIcon } from "./iconPaths";

export { launcherIconIds, launcherIcons, whatsappIcon } from "./iconPaths";
export type { tLauncherIcon } from "./iconPaths";

export function LauncherIcon(props: { icon?: string; size?: number }): ReactElement {
  const icon =
    launcherIcons[(props.icon ?? "chat") as tLauncherIcon] ?? launcherIcons.chat;
  return <PathIcon path={icon.path} size={props.size} />;
}

export function WhatsappIcon(props: { size?: number }): ReactElement {
  return <PathIcon path={whatsappIcon.path} size={props.size ?? 16} />;
}

function PathIcon(props: { path: string; size?: number }): ReactElement {
  return (
    <svg
      width={props.size ?? 24}
      height={props.size ?? 24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={props.path} />
    </svg>
  );
}
