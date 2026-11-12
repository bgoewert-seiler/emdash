import { defineIntegrationPlugin, registerIntegrationPluginBehavior } from '../../plugin';
import { icon } from './icon';

/** Reads each project's own `TODO.md` files and TODO comments, so there is no account to connect. */
const plugin = defineIntegrationPlugin(
  {
    id: 'todo',
    name: 'TODOs',
    description: 'Start tasks from TODO.md checklists and TODO comments',
    // No product site: the source is the project's own files.
    websiteUrl: '',
  },
  { auth: { methods: [] } },
  { icon }
);

export const provider = registerIntegrationPluginBehavior(plugin, {});
