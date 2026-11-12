import type { PluginIconAsset } from '@emdash/shared/plugins';

export const icon: PluginIconAsset = {
  kind: 'svg',
  alt: 'TODOs',
  variants: [
    {
      minSize: 0,
      light: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="5" fill="#18181B"/><rect x="6" y="6.5" width="4" height="4" rx="1" fill="none" stroke="#fff" stroke-width="1.5"/><rect x="6" y="13.5" width="4" height="4" rx="1" fill="none" stroke="#fff" stroke-width="1.5"/><path d="M12.5 8.5H18M12.5 15.5H18" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    },
  ],
};
