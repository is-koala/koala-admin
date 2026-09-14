import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function strokeIcon(d: string) {
  return function NavGlyph(props: IconProps) {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true" {...props}>
        <path
          d={d}
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  };
}

const HomeIcon = strokeIcon("M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z");
const FolderIcon = strokeIcon(
  "M4 7.5A1.5 1.5 0 0 1 5.5 6h4l2 2H18.5A1.5 1.5 0 0 1 20 9.5v8A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5z",
);
const AwardIcon = strokeIcon(
  "M8 11.5 12 4l4 7.5M8.5 14a3.5 3.5 0 1 0 7 0 3.5 3.5 0 0 0-7 0Zm.8 3.2L7 21h10l-2.3-3.8",
);
const FlagIcon = strokeIcon("M5 4v16M5 5h10l-1.5 3.5L19 12H5");
const TrashIcon = strokeIcon("M5 7h14M10 7V5h4v2m1 0v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V7");
const UsersIcon = strokeIcon(
  "M15 19v-1a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v1M9.5 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm11.5 9.5v-1a3 3 0 0 0-2.2-2.9M16.5 6.2a3 3 0 0 1 0 5.6",
);
const BriefcaseIcon = strokeIcon(
  "M4 9.5A1.5 1.5 0 0 1 5.5 8h13A1.5 1.5 0 0 1 20 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM9 8V6.5A1.5 1.5 0 0 1 10.5 5h3A1.5 1.5 0 0 1 15 6.5V8M4 13h16",
);
const BuildingIcon = strokeIcon(
  "M5 21V5.5A1.5 1.5 0 0 1 6.5 4h7A1.5 1.5 0 0 1 16 5.5V21M16 10h2.5A1.5 1.5 0 0 1 20 11.5V21M9 8h.01M12 8h.01M9 12h.01M12 12h.01M9 16h.01M12 16h.01M4 21h16",
);
const IdIcon = strokeIcon(
  "M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 21 7.5v9A1.5 1.5 0 0 1 18.5 18h-13A1.5 1.5 0 0 1 4 16.5zM8 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm4.5 0h5M12.5 15h5",
);
const ScaleIcon = strokeIcon("M12 4v16M8 20h8M12 7l-6 8h5l1-2 1 2h5z");
const WalletIcon = strokeIcon(
  "M4 8.5A1.5 1.5 0 0 1 5.5 7h13A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5zM16 12.5h3.5V15H16a1.5 1.5 0 0 1 0-3Z",
);
const SearchIcon = strokeIcon("M10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 0 0 13Zm5.5-1.5 3.5 3.5");
const LandmarkIcon = strokeIcon(
  "M4 10.5 12 5l8 5.5M6 10.5V18M10 10.5V18M14 10.5V18M18 10.5V18M4 21h16",
);
const ReceiptIcon = strokeIcon(
  "M7 4.5h10A1.5 1.5 0 0 1 18.5 6v14L15 18.5 12 20.5 9 18.5 5.5 20V6A1.5 1.5 0 0 1 7 4.5ZM9 9h6M9 13h6",
);
const SlidersIcon = strokeIcon("M5 7h14M5 12h14M5 17h14M8 7V5M16 12V10M11 17v-2");
const ShieldIcon = strokeIcon("M12 3.5 19 6.5v5.2c0 4.2-3 7.3-7 8.8-4-1.5-7-4.6-7-8.8V6.5z");
const PersonIcon = strokeIcon("M12 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM6 20a6 6 0 0 1 12 0");
const ClipboardIcon = strokeIcon(
  "M9 5.5h6M9 4h6a1 1 0 0 1 1 1v1.5h1.5A1.5 1.5 0 0 1 19 8v11.5A1.5 1.5 0 0 1 17.5 21h-11A1.5 1.5 0 0 1 4 19.5V8A1.5 1.5 0 0 1 5.5 6.5H7V5a1 1 0 0 1 1-1Z",
);

const BY_HREF: Record<string, typeof HomeIcon> = {
  "/": HomeIcon,
  "/job-categories": FolderIcon,
  "/badges": AwardIcon,
  "/reports": FlagIcon,
  "/account-deletions": TrashIcon,
  "/users": UsersIcon,
  "/jobs": BriefcaseIcon,
  "/companies": BuildingIcon,
  "/identity-reviews": IdIcon,
  "/disputes": ScaleIcon,
  "/finance": WalletIcon,
  "/assignments": SearchIcon,
  "/iban-verifications": LandmarkIcon,
  "/payout-reconciliation": ReceiptIcon,
  "/settings": SlidersIcon,
  "/roles": ShieldIcon,
  "/staff": PersonIcon,
  "/audit-log": ClipboardIcon,
};

export function NavIcon({ href }: { href: string }) {
  const Icon = BY_HREF[href] ?? FolderIcon;
  return <Icon className="shrink-0" />;
}

export function HomeNavIcon() {
  return <HomeIcon className="shrink-0" />;
}
