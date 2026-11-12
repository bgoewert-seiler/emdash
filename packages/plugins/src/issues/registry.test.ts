import { describe, expect, it } from 'vitest';
import { integrationPluginRegistry } from '../integrations';
import { issuesPluginRegistry } from './registry';

describe('issue plugin registry', () => {
  it('registers valid issue plugins for existing integrations', () => {
    const integrationIds = integrationPluginRegistry.ids();
    const issueIntegrationIds = issuesPluginRegistry.ids();

    expect(new Set(integrationIds).size).toBe(integrationIds.length);
    expect(new Set(issueIntegrationIds).size).toBe(issueIntegrationIds.length);
    expect(issueIntegrationIds).toEqual(expect.arrayContaining(['openspec', 'todo']));

    for (const integrationId of issueIntegrationIds) {
      expect(integrationPluginRegistry.get(integrationId)).toBeDefined();
    }

    for (const plugin of integrationPluginRegistry.getAll()) {
      expect(plugin.validate()).toEqual([]);
    }

    for (const plugin of issuesPluginRegistry.getAll()) {
      expect(plugin.validate()).toEqual([]);
      expect(plugin.behavior.issues).toBeDefined();
    }
  });
});
