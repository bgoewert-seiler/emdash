import { defineIntegrationPlugin, registerIntegrationPluginBehavior } from '../../plugin';
import { icon } from './icon';

/** Reads each project's own `openspec/` folder, so there is no account to connect. */
const plugin = defineIntegrationPlugin(
  {
    id: 'openspec',
    name: 'OpenSpec',
    description: 'Start tasks from OpenSpec change proposals',
    websiteUrl: 'https://github.com/Fission-AI/OpenSpec',
  },
  { auth: { methods: [] } },
  { icon }
);

export const provider = registerIntegrationPluginBehavior(plugin, {});
