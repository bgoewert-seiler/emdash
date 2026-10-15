import type { PluginIconAsset } from '@emdash/shared/plugins';

export const icon: PluginIconAsset = {
  kind: 'svg',
  alt: 'OpenSpec',
  variants: [
    {
      minSize: 0,
      light: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="5" fill="#18181B"/><path d="M7 5.5h7l3 3v10H7z" fill="none" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/><path d="M9.5 13l1.75 1.75L14.5 11.5" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    },
  ],
};
