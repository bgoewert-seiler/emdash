import type { WorkspaceConfigState } from '@core/features/tasks/api/browser/create-task-modal/use-workspace-config';

/** Warns that the linked change's files are on a branch this task will not start from. */
export function IssueBranchNotice({
  notice,
}: {
  notice: NonNullable<WorkspaceConfigState['issueBranchNotice']>;
}) {
  return (
    <p
      role="status"
      className="rounded-md border border-border-warning bg-background-warning px-3 py-2.5 text-xs text-foreground-warning"
    >
      This issue lives on <strong className="font-medium">{notice.sourceBranch}</strong>
      {notice.runsOn ? (
        <>
          , but the task will run on <strong className="font-medium">{notice.runsOn}</strong>
        </>
      ) : (
        ', but the task will not start from it'
      )}
      . Create a branch and worktree to start from {notice.sourceBranch}.
    </p>
  );
}
