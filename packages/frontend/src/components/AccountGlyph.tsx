// spec: docs/frontend/dashboard-components.md#topbar (account icon, Figma node 6701:97941)
export function AccountGlyph({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2ZM12 15C9.50076 15 7.21741 15.9185 5.46484 17.4346C7.02402 19.3075 9.37255 20.5 12 20.5C14.6272 20.5 16.975 19.3072 18.5342 17.4346C16.7818 15.9187 14.499 15 12 15ZM12 6C10.1429 6 8.75 7.567 8.75 9.5C8.75 11.433 10.1429 13 12 13C13.8571 13 15.25 11.433 15.25 9.5C15.25 7.567 13.8571 6 12 6Z"
        fill="currentColor"
      />
    </svg>
  );
}

export default AccountGlyph;
