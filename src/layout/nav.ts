import {
  cloudUploadOutline,
  homeOutline,
  listOutline,
  settingsOutline,
  peopleOutline,
  swapHorizontalOutline,
  walletOutline,
} from 'ionicons/icons';

/**
 * Top-level sections: sidebar on desktop; bottom tabs on phones for those with
 * `phoneTab: true` (five fit; the rest are reached from a related page).
 */
export const NAV_ITEMS = [
  { tab: 'overview', href: '/overview', label: 'Overview', icon: homeOutline, phoneTab: true },
  { tab: 'transactions', href: '/transactions', label: 'Transactions', icon: listOutline, phoneTab: true },
  { tab: 'transfers', href: '/transfers', label: 'Transfers', icon: swapHorizontalOutline, phoneTab: false },
  { tab: 'shared', href: '/shared', label: 'Shared', icon: peopleOutline, phoneTab: false },
  { tab: 'import', href: '/import', label: 'Import', icon: cloudUploadOutline, phoneTab: true },
  { tab: 'accounts', href: '/accounts', label: 'Accounts', icon: walletOutline, phoneTab: true },
  { tab: 'settings', href: '/settings', label: 'Settings', icon: settingsOutline, phoneTab: true },
] as const;
