import { cloudUploadOutline, homeOutline, listOutline, settingsOutline, walletOutline } from 'ionicons/icons';

/** Top-level sections: bottom tabs on phones, sidebar on desktop. */
export const NAV_ITEMS = [
  { tab: 'overview', href: '/overview', label: 'Overview', icon: homeOutline },
  { tab: 'transactions', href: '/transactions', label: 'Transactions', icon: listOutline },
  { tab: 'import', href: '/import', label: 'Import', icon: cloudUploadOutline },
  { tab: 'accounts', href: '/accounts', label: 'Accounts', icon: walletOutline },
  { tab: 'settings', href: '/settings', label: 'Settings', icon: settingsOutline },
] as const;
