import { ProjectSetupWizard } from './ProjectSetupViews';
import { useProjectSetupController } from './useProjectSetupController';

export { validateSourceFile } from './source-validation';

export function ProjectSetupScreen({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (projectId: string) => void;
}) {
  const controller = useProjectSetupController(onCreated);
  return <ProjectSetupWizard controller={controller} onCancel={onCancel} />;
}
