import type { ReactElement } from "react";
import { launcherIcons } from "./iconPaths";
import type { tLauncherIcon } from "./iconPaths";

export { launcherIconIds, launcherIcons } from "./iconPaths";
export type { tLauncherIcon } from "./iconPaths";

export function LauncherIcon(props: { icon?: string; size?: number }): ReactElement {
  const icon =
    launcherIcons[(props.icon ?? "chat") as tLauncherIcon] ?? launcherIcons.chat;
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
      <path d={icon.path} />
    </svg>
  );
}
