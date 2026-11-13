import React from 'react';

interface RhinoLogoProps {
  size?: number;
  className?: string;
}

export const RhinoLogo: React.FC<RhinoLogoProps> = ({ size = 36, className = '' }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 56 56"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="77 TRADE IT Rhino Monogram"
    >
      <defs>
        <linearGradient id="gold77" x1="8" y1="8" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fff0b8" />
          <stop offset="45%" stopColor="#e5be53" />
          <stop offset="100%" stopColor="#9c7316" />
        </linearGradient>
        <linearGradient id="goldBg" x1="0" y1="0" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#121a2d" />
          <stop offset="100%" stopColor="#070b15" />
        </linearGradient>
      </defs>
      <rect
        x="1.5"
        y="1.5"
        width="53"
        height="53"
        rx="12"
        fill="url(#goldBg)"
        stroke="url(#gold77)"
        strokeOpacity="0.65"
        strokeWidth="1.5"
      />
      {/* Stylized double-7 charging rhino horn monogram */}
      <path
        d="M12 16H33L21 41H15.5L24.5 21.5H12V16Z"
        fill="url(#gold77)"
      />
      <path
        d="M27 16H45L33 41H27.5L36.5 21.5H27V16Z"
        fill="url(#gold77)"
        fillOpacity="0.88"
      />
      {/* Swept charging rhino horn silhouette cutting through the 77 */}
      <path
        d="M11 33C19 30 29 25 44 14C39 22 33 27 24 31L11 33Z"
        fill="#fff3c4"
        fillOpacity="0.92"
      />
    </svg>
  );
};
