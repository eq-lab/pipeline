import React from "react";

/** DocumentIcon — redrawn inline (Figma node `4116:9364`'s asset is a
 * localhost dev-server SVG, not fetchable at runtime). Filled `currentColor`
 * glyph — the Figma asset is `fill="#000080"` (solid navy), not an outline.
 * Shared by `origination.$id.tsx` and `loans.$id.tsx`'s Documents card. */
export function DocumentIcon(props: React.SVGAttributes<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width={16}
      height={16}
      {...props}
    >
      {/* Filled body with the folded corner cut out via fill-rule. */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M4 1.5C3.44772 1.5 3 1.94772 3 2.5V13.5C3 14.0523 3.44772 14.5 4 14.5H12C12.5523 14.5 13 14.0523 13 13.5V5.20711L9.29289 1.5H4ZM9 2.5V5C9 5.27614 9.22386 5.5 9.5 5.5H12L9 2.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

export default DocumentIcon;
