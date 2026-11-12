import { PageLayout, SettingsSection } from '@emdash/ui/react/patterns';
import RepositorySettingsCard from '../components/RepositorySettingsCard';
import TodoSettingsCard from '../components/TodoSettingsCard';

export function RepositorySettingsPage() {
  return (
    <div className="space-y-8">
      <PageLayout.Header
        sticky
        title="Repository"
        description="Configure repository, branch and TODO scanning settings."
      />
      <SettingsSection title="Branches" bare>
        <RepositorySettingsCard />
      </SettingsSection>
      <SettingsSection title="TODOs" bare>
        <TodoSettingsCard />
      </SettingsSection>
    </div>
  );
}
