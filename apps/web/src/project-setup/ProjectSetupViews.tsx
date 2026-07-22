import { ArrowLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowLeft';
import { ArrowRightIcon } from '@phosphor-icons/react/dist/csr/ArrowRight';
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { FilePdfIcon } from '@phosphor-icons/react/dist/csr/FilePdf';
import { FolderPlusIcon } from '@phosphor-icons/react/dist/csr/FolderPlus';
import { ListChecksIcon } from '@phosphor-icons/react/dist/csr/ListChecks';
import { TreeStructureIcon } from '@phosphor-icons/react/dist/csr/TreeStructure';
import { UploadSimpleIcon } from '@phosphor-icons/react/dist/csr/UploadSimple';
import { UsersIcon } from '@phosphor-icons/react/dist/csr/Users';
import { CustomSelect } from '../components/CustomSelect';
import styles from './ProjectSetupScreen.module.css';
import type { StepId } from './types';
import type { ProjectSetupController } from './useProjectSetupController';

const steps: Array<{ id: StepId; label: string; icon: typeof FolderPlusIcon }> = [
  { id: 'details', label: 'Project details', icon: FolderPlusIcon },
  { id: 'entities', label: 'Entity setup', icon: TreeStructureIcon },
  { id: 'source', label: 'Source document', icon: FilePdfIcon },
  { id: 'member', label: 'Invite member', icon: UsersIcon },
  { id: 'summary', label: 'Summary', icon: ListChecksIcon },
];

function SetupProgress({ stepIndex }: { stepIndex: number }) {
  return (
    <ol className={styles.progress} aria-label="Project setup progress">
      {steps.map((item, index) => {
        const complete = index < stepIndex;
        const active = index === stepIndex;
        const Icon = item.icon;
        return (
          <li key={item.id} data-active={active || undefined} data-complete={complete || undefined}>
            <span className={styles.progressIcon}>
              {complete ? (
                <CheckIcon size={12} weight="bold" aria-hidden="true" />
              ) : (
                <Icon size={12} aria-hidden="true" />
              )}
            </span>
            <span>{item.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function DetailsStep({ controller }: { controller: ProjectSetupController }) {
  return (
    <>
      <div className={styles.stepHeading}>
        <h2 id="details-heading">Project details</h2>
        <p>Name the workspace and add a short description for collaborators.</p>
      </div>
      <div className={styles.formBody}>
        <div className={styles.field}>
          <span>Starting point</span>
          <CustomSelect
            ariaLabel="Project template"
            value={controller.templateId}
            options={controller.templateOptions}
            disabled={controller.options.isLoading || controller.options.isError}
            onChange={controller.chooseTemplate}
          />
          <small className={styles.fieldHelp}>
            {controller.selectedTemplate?.description ??
              'Configure a Sequence, Scene, and Shot hierarchy yourself.'}
          </small>
        </div>
        <label className={styles.field}>
          <span>Project name</span>
          <input
            autoFocus
            required
            value={controller.name}
            placeholder="Untitled project"
            onChange={(event) => controller.setName(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>
            Description <small>Optional</small>
          </span>
          <textarea
            rows={4}
            value={controller.description}
            placeholder="What is this project for?"
            onChange={(event) => controller.setDescription(event.target.value)}
          />
        </label>
      </div>
    </>
  );
}

function BlankEntityFields({ controller }: { controller: ProjectSetupController }) {
  return (
    <>
      <div className={styles.depthPicker} role="group" aria-label="Hierarchy depth">
        {[1, 2, 3].map((count) => (
          <button
            key={count}
            type="button"
            aria-pressed={controller.levelCount === count}
            onClick={() => controller.setLevelCount(count)}
          >
            <strong>{count}</strong>
            {count === 1 ? 'level' : 'levels'}
            <span className={styles.choiceMark}>
              {controller.levelCount === count && <CheckIcon size={12} weight="bold" />}
            </span>
          </button>
        ))}
      </div>
      <div className={styles.levelList}>
        {controller.levels.slice(0, controller.levelCount).map((level, index) => (
          <div className={styles.levelRow} key={index}>
            <span className={styles.levelIndex}>{index + 1}</span>
            <label>
              <span>Singular</span>
              <input
                aria-label={`Level ${index + 1} singular name`}
                value={level.singular}
                onChange={(event) => controller.updateLevel(index, 'singular', event.target.value)}
              />
            </label>
            <label>
              <span>Plural</span>
              <input
                aria-label={`Level ${index + 1} plural name`}
                value={level.plural}
                onChange={(event) => controller.updateLevel(index, 'plural', event.target.value)}
              />
            </label>
          </div>
        ))}
      </div>
    </>
  );
}

function TemplateEntityFields({ controller }: { controller: ProjectSetupController }) {
  return (
    <div className={styles.templateStructure}>
      {controller.levels.slice(0, controller.levelCount).map((level, index) => (
        <div key={level.singular}>
          <span>{index + 1}</span>
          <strong>{level.plural}</strong>
          <small>{level.singular}</small>
        </div>
      ))}
      <p>Recommended custom fields are added automatically and remain editable.</p>
    </div>
  );
}

function EntitiesStep({ controller }: { controller: ProjectSetupController }) {
  return (
    <>
      <div className={styles.stepHeading}>
        <h2 id="entities-heading">Entity setup</h2>
        <p>Choose one to three ordered levels. You can rename them later.</p>
      </div>
      <div className={styles.formBody}>
        {controller.templateId === 'blank' ? (
          <BlankEntityFields controller={controller} />
        ) : (
          <TemplateEntityFields controller={controller} />
        )}
      </div>
    </>
  );
}

function SourceStep({ controller }: { controller: ProjectSetupController }) {
  return (
    <>
      <div className={styles.stepHeading}>
        <h2 id="source-heading">Source document</h2>
        <p>
          {controller.sourceRequired
            ? 'Add the project’s source PDF.'
            : 'Add a source PDF now, or continue and upload one later.'}
        </p>
      </div>
      <div className={styles.formBody}>
        <label className={`${styles.dropZone} ${controller.sourceFile ? styles.hasFile : ''}`}>
          <FilePdfIcon size={24} aria-hidden="true" />
          {controller.sourceFile ? (
            <>
              <strong>{controller.sourceFile.name}</strong>
              <span>{(controller.sourceFile.size / 1024 / 1024).toFixed(1)} MB · PDF selected</span>
            </>
          ) : (
            <>
              <strong>Choose a source PDF</strong>
              <span>One PDF, up to 250 MB</span>
            </>
          )}
          <span className={styles.fileButton}>
            <UploadSimpleIcon size={12} aria-hidden="true" />
            {controller.sourceFile ? 'Replace file' : 'Browse'}
          </span>
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => controller.chooseSource(event.target.files?.[0])}
          />
        </label>
        {controller.sourceError && (
          <div className={styles.error} role="alert">
            {controller.sourceError}
          </div>
        )}
      </div>
    </>
  );
}

function MemberStep({ controller }: { controller: ProjectSetupController }) {
  return (
    <>
      <div className={styles.stepHeading}>
        <h2 id="member-heading">
          Invite a member <small>Optional</small>
        </h2>
        <p>Optionally add one registered account. More members can be added later.</p>
      </div>
      <div className={styles.formBody}>
        <div className={styles.field}>
          <span>Member</span>
          <CustomSelect
            ariaLabel="Project member"
            value={controller.selectedUserId}
            options={controller.userOptions}
            disabled={controller.options.isLoading || controller.options.isError}
            placeholder={controller.options.isLoading ? 'Loading accounts…' : 'No member'}
            onChange={controller.setSelectedUserId}
          />
        </div>
        <div className={styles.field}>
          <span>Role</span>
          <CustomSelect
            ariaLabel="Project role"
            value={controller.selectedRoleName}
            options={controller.roleOptions}
            disabled={!controller.selectedUserId || controller.options.isLoading}
            onChange={controller.setSelectedRoleName}
          />
        </div>
        {controller.options.isError && (
          <div className={styles.error} role="alert">
            Registered accounts could not be loaded. You can continue without a member.
          </div>
        )}
      </div>
    </>
  );
}

function SummaryRow({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className={styles.summaryRow}>
      <span>{label}</span>
      <strong data-muted={muted || undefined}>{value}</strong>
    </div>
  );
}

function SummaryStep({ controller }: { controller: ProjectSetupController }) {
  const member = controller.selectedUser
    ? `${controller.selectedUser.displayName} · ${controller.selectedRole?.name ?? controller.selectedRoleName}`
    : 'No member';
  const source =
    controller.sourceFile?.name ?? (controller.sourceRequired ? 'No PDF selected' : 'Add later');
  return (
    <>
      <div className={styles.stepHeading}>
        <h2 id="summary-heading">Review and create</h2>
        <p>Nothing is created until you confirm these project settings.</p>
      </div>
      <div className={styles.summary}>
        <SummaryRow label="Project" value={controller.name.trim()} />
        <SummaryRow
          label="Starting point"
          value={controller.selectedTemplate?.name ?? 'Blank project'}
        />
        <SummaryRow
          label="Description"
          value={controller.description.trim() || 'No description'}
          muted={!controller.description.trim()}
        />
        <SummaryRow
          label="Entity structure"
          value={controller.levels
            .slice(0, controller.levelCount)
            .map((level) => level.plural.trim())
            .join(' → ')}
        />
        <SummaryRow label="Source document" value={source} muted={!controller.sourceFile} />
        <SummaryRow label="Member" value={member} muted={!controller.selectedUser} />
      </div>
      {(controller.error || controller.progress) && (
        <div
          className={controller.error ? styles.creationError : styles.creationProgress}
          role={controller.error ? 'alert' : 'status'}
        >
          <span className={styles.statusDot} />
          <div>
            <strong>{controller.error ? 'Setup paused' : 'Creating project'}</strong>
            <span>
              {controller.error
                ? `${controller.error}${controller.pending.current.projectId ? ' Retry will continue this project.' : ''}`
                : controller.progress}
            </span>
          </div>
        </div>
      )}
    </>
  );
}

function StepContent({ controller }: { controller: ProjectSetupController }) {
  switch (controller.step) {
    case 'details':
      return <DetailsStep controller={controller} />;
    case 'entities':
      return <EntitiesStep controller={controller} />;
    case 'source':
      return <SourceStep controller={controller} />;
    case 'member':
      return <MemberStep controller={controller} />;
    case 'summary':
      return <SummaryStep controller={controller} />;
  }
}

function SetupActions({
  controller,
  onCancel,
}: {
  controller: ProjectSetupController;
  onCancel: () => void;
}) {
  const skip =
    (controller.step === 'member' && !controller.selectedUserId) ||
    (controller.step === 'source' && !controller.sourceFile && !controller.sourceRequired);
  const createDisabled =
    controller.busy ||
    !controller.detailsComplete ||
    !controller.entitiesComplete ||
    (controller.sourceRequired && !controller.sourceFile);
  return (
    <footer className={styles.actions}>
      <button
        type="button"
        className={styles.secondaryButton}
        disabled={controller.busy}
        onClick={controller.stepIndex === 0 ? onCancel : controller.previousStep}
      >
        {controller.stepIndex > 0 && <ArrowLeftIcon size={12} aria-hidden="true" />}
        {controller.stepIndex === 0 ? 'Cancel' : 'Back'}
      </button>
      {controller.step === 'summary' ? (
        <button
          type="button"
          className={styles.primaryButton}
          disabled={createDisabled}
          onClick={() => void controller.create()}
        >
          {controller.busy
            ? 'Creating…'
            : controller.error
              ? 'Continue setup'
              : 'Confirm and create'}
        </button>
      ) : (
        <button
          type="button"
          className={styles.primaryButton}
          disabled={!controller.canContinue}
          onClick={controller.nextStep}
        >
          {skip ? 'Skip for now' : 'Continue'}
          <ArrowRightIcon size={12} aria-hidden="true" />
        </button>
      )}
    </footer>
  );
}

export function ProjectSetupWizard({
  controller,
  onCancel,
}: {
  controller: ProjectSetupController;
  onCancel: () => void;
}) {
  return (
    <main className={styles.page}>
      <section className={styles.wizard} aria-labelledby="new-project-title">
        <header className={styles.header}>
          <h1 id="new-project-title">Create a project</h1>
          <p>Set up one focused decision at a time.</p>
        </header>
        <SetupProgress stepIndex={controller.stepIndex} />
        <section
          key={controller.step}
          className={styles.stepPanel}
          aria-labelledby={`${controller.step}-heading`}
        >
          <StepContent controller={controller} />
          <SetupActions controller={controller} onCancel={onCancel} />
        </section>
      </section>
    </main>
  );
}
