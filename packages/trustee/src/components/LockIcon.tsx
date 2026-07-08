import React from "react";

/**
 * LockIcon — 24×24 padlock glyph used inside the sign-in card's navy icon
 * badge (Figma node `4174:33922`, frame `4174-31660`). Painted with
 * `currentColor` so the caller controls tint via CSS `color` (white on the
 * navy badge in this design).
 *
 * Trustee-local for now — only the sign-in screen uses it. Promote to
 * `@pipeline/ui` if a second consumer appears.
 */
export function LockIcon(props: React.SVGAttributes<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2.75C9.37665 2.75 7.25 4.87665 7.25 7.5V10H6.5C5.53351 10 4.75 10.7835 4.75 11.75V19.25C4.75 20.2165 5.53351 21 6.5 21H17.5C18.4665 21 19.25 20.2165 19.25 19.25V11.75C19.25 10.7835 18.4665 10 17.5 10H16.75V7.5C16.75 4.87665 14.6234 2.75 12 2.75ZM15.25 7.5V10H8.75V7.5C8.75 5.70507 10.2051 4.25 12 4.25C13.7949 4.25 15.25 5.70507 15.25 7.5ZM6.5 11.5H17.5C17.6381 11.5 17.75 11.6119 17.75 11.75V19.25C17.75 19.3881 17.6381 19.5 17.5 19.5H6.5C6.36193 19.5 6.25 19.3881 6.25 19.25V11.75C6.25 11.6119 6.36193 11.5 6.5 11.5ZM12.75 14.5C12.75 14.0858 12.4142 13.75 12 13.75C11.5858 13.75 11.25 14.0858 11.25 14.5V16.5C11.25 16.9142 11.5858 17.25 12 17.25C12.4142 17.25 12.75 16.9142 12.75 16.5V14.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

export default LockIcon;
