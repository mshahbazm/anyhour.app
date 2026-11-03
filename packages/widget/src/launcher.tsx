import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { greeting, launcherLabel } from "./appearance";
import type { iAppearance } from "./appearance";
import { BotAvatarImage } from "./botChat";
import { LauncherIcon } from "./icons";

const closeIcon = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

interface iLauncherProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  appearance: iAppearance;
  name: string;
  pictureUrl: string | null;
  open: boolean;
}

// The closed chat on a website. Forwards its ref and props so a modal
// trigger can wrap it; the dashboard preview uses it as a plain button.
export const LauncherButton = forwardRef<HTMLButtonElement, iLauncherProps>(
  function LauncherButton({ appearance, name, pictureUrl, open, className, ...button }, ref) {
    const style = appearance.launcher;
    return (
      <button
        ref={ref}
        type="button"
        aria-label={open ? "Close chat" : `Chat with ${name}`}
        {...button}
        className={`wpEmbedLauncher is-${style} ${open ? "is-open" : ""} ${className ?? ""}`}
      >
        {open ? (
          closeIcon
        ) : style === "avatar" ? (
          <BotAvatarImage url={pictureUrl} name={name} />
        ) : style === "label" ? (
          <>
            <LauncherIcon icon={appearance.launcherIcon} size={22} />
            <span>{launcherLabel(appearance, name)}</span>
          </>
        ) : (
          <LauncherIcon icon={appearance.launcherIcon} />
        )}
      </button>
    );
  },
);

// The greeting and starter questions that float above the closed chat.
export function Teaser(props: {
  name: string;
  welcomeMessage?: string;
  prompts: string[];
  onOpen: () => void;
  onPrompt: (prompt: string) => void;
  onDismiss?: () => void;
}) {
  return (
    <div className="wpTeaser" role="dialog" aria-label={`Message from ${props.name}`}>
      {props.onDismiss && (
        <button type="button" className="wpTeaserClose" aria-label="Dismiss" onClick={props.onDismiss}>
          ×
        </button>
      )}
      <button type="button" className="wpTeaserBubble" onClick={props.onOpen}>
        {greeting(props.name, props.welcomeMessage)}
      </button>
      {props.prompts.map((prompt) => (
        <button key={prompt} type="button" className="wpTeaserPrompt" onClick={() => props.onPrompt(prompt)}>
          {prompt}
        </button>
      ))}
    </div>
  );
}
