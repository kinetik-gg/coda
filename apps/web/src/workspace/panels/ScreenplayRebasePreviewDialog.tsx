import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApplyScreenplayRebaseInput,
  ScreenplayRebaseApplyResult,
  ScreenplayRebaseCandidate,
  ScreenplayRebaseDecisionInput,
  ScreenplayRebaseEntry,
  ScreenplayRebaseExcerpt,
  ScreenplayRebasePlan,
} from '@coda/contracts';
import { api } from '../../api';
import { ModalShell, modalButtonStyles } from '../../components/ModalShell';
import { Skeleton, SkeletonGroup } from '../../components/Skeleton';
import {
  REBASE_ATTENTION,
  REBASE_CLASSIFICATION_LABEL,
  REBASE_EXCLUSION_EXPLANATION,
  REBASE_REASON_EXPLANATION,
  rebaseSummarySentence,
} from './screenplay-rebase-language';
import styles from './Panels.styles';

/**
 * The rebase review-and-apply surface (#242 review, #243 apply).
 *
 * **Opening, scrolling, and deciding writes nothing.** It issues one `GET` for the plan and holds
 * every decision in local component state. Exactly one action in this component mutates anything —
 * the Apply button — and it is disabled until every range that needs a decision has one, so the
 * request can never be sent half-answered.
 *
 * The plan already carries a `reason` for every verdict, so this component renders that reason
 * rather than inferring one, and it never re-derives `autoApplicable`: ranges the engine marked
 * auto-applicable are summarised in one line, and everything else is listed as its own decision —
 * including the cases that are easy to get wrong, where several candidate anchors are equally
 * plausible, where the text was deleted outright, and where a pin disagrees with its own revision.
 *
 * The dialog never invents an anchor. A `retarget` decision carries a candidate's own range and
 * hash, straight off the plan, which is exactly what the server will require it to match.
 */

export function screenplayRebasePreviewQueryKey(projectId: string): [string, string] {
  return ['screenplay-rebase-preview', projectId];
}

/** What a reviewer has chosen for one entry. Held in memory only until Apply submits it. */
type Decision = { kind: 'keep' } | { kind: 'candidate'; index: number };

/**
 * Turns the reviewer's in-memory choices into the request body.
 *
 * Only entries the plan marked `decisionRequired` are listed, and every one of them is sent — an
 * entry left out of the body would be read by the server as "no decision", which for anything
 * reviewable is a refusal rather than a silent carry. Auto-applicable ranges are deliberately absent:
 * they carry over on the engine's own evidence, and sending a decision for them would misrepresent an
 * automatic move as a confirmed one in the audit trail.
 */
export function rebaseApplyBody(
  plan: ScreenplayRebasePlan,
  decisions: Record<string, Decision>,
): ApplyScreenplayRebaseInput {
  const recorded: ScreenplayRebaseDecisionInput[] = [];
  for (const entry of plan.entries) {
    if (!entry.decisionRequired) continue;
    const decision = decisions[entry.itemSourceReferenceId];
    if (!decision || decision.kind === 'keep') {
      recorded.push({ itemSourceReferenceId: entry.itemSourceReferenceId, action: 'keep' });
      continue;
    }
    const candidate = entry.candidates[decision.index];
    if (!candidate) continue;
    recorded.push({
      itemSourceReferenceId: entry.itemSourceReferenceId,
      action: 'retarget',
      source: candidate.range,
      sourceTextHash: candidate.textHash,
    });
  }
  return { planVersion: plan.planVersion, fingerprint: plan.fingerprint, decisions: recorded };
}

function Excerpt({ excerpt, label }: { excerpt: ScreenplayRebaseExcerpt; label: string }) {
  return (
    <div className={styles.rebaseExcerpt}>
      <span className={styles.rebaseExcerptLabel}>
        {label} · {excerpt.range.start}–{excerpt.range.end}
      </span>
      <pre>{excerpt.text}</pre>
      {excerpt.textTruncated && (
        <span className={styles.rebaseExcerptLabel}>Shortened for display.</span>
      )}
    </div>
  );
}

function candidateLabel(candidate: ScreenplayRebaseCandidate, isProposed: boolean): string {
  const move = candidate.shift === 0 ? 'same offset' : `moved ${String(candidate.shift)}`;
  const text = candidate.identicalText ? 'identical text' : 'different text';
  return `${isProposed ? 'Proposed · ' : ''}${text} · ${move}`;
}

function EntryDecision({
  entry,
  decision,
  onDecide,
}: {
  entry: ScreenplayRebaseEntry;
  decision: Decision | undefined;
  onDecide: (decision: Decision) => void;
}) {
  const attention = REBASE_ATTENTION[entry.classification];
  const name = `rebase-${entry.itemSourceReferenceId}`;
  return (
    <li className={styles.rebaseEntry}>
      <div className={styles.rebaseEntryHead}>
        <span className={`${styles.rebaseBadge} ${styles[`rebaseBadge_${attention}`] ?? ''}`}>
          {REBASE_CLASSIFICATION_LABEL[entry.classification]}
        </span>
        <span className={styles.rebaseEntryReason}>{REBASE_REASON_EXPLANATION[entry.reason]}</span>
      </div>
      {!entry.from.recordedTextHashMatches && (
        <p className={styles.rebaseWarning} role="alert">
          This pin&rsquo;s recorded text does not match the revision it names.
        </p>
      )}
      <Excerpt excerpt={entry.from.excerpt} label="Pinned text" />
      <fieldset className={styles.rebaseChoices}>
        <legend>What should happen to this reference?</legend>
        <label>
          <input
            type="radio"
            name={name}
            checked={decision?.kind === 'keep'}
            onChange={() => onDecide({ kind: 'keep' })}
          />
          <span>Keep the current pin</span>
        </label>
        {entry.candidates.map((candidate, index) => (
          <label key={`${String(candidate.range.start)}-${String(candidate.range.end)}`}>
            <input
              type="radio"
              name={name}
              checked={decision?.kind === 'candidate' && decision.index === index}
              onChange={() => onDecide({ kind: 'candidate', index })}
            />
            <span>
              {candidateLabel(candidate, candidate.range.start === entry.proposed?.range.start)}
              <Excerpt excerpt={candidate} label="New text" />
            </span>
          </label>
        ))}
        {!entry.candidates.length && (
          <p className={styles.empty}>
            The plan proposes no new anchor, so the pin can only be kept as it is.
          </p>
        )}
        {entry.candidatesTruncated && (
          <p className={styles.empty}>More matches exist than the plan could list.</p>
        )}
      </fieldset>
    </li>
  );
}

function PlanBody({
  plan,
  decisions,
  onDecide,
}: {
  plan: ScreenplayRebasePlan;
  decisions: Record<string, Decision>;
  onDecide: (referenceId: string, decision: Decision) => void;
}) {
  const pending = plan.entries.filter((entry) => entry.decisionRequired);
  return (
    <div className={styles.rebasePlan}>
      <p className={styles.rebaseSummary}>{rebaseSummarySentence(plan.summary)}</p>
      <p className={styles.rebaseSummaryDetail}>
        Screenplay version {plan.target.screenplayVersion}. Nothing is written until the rebase is
        applied.
      </p>
      {!pending.length && !!plan.entries.length && (
        <p className={styles.empty}>
          Every pinned range carries over on its own. Nothing to decide.
        </p>
      )}
      <ul className={styles.rebaseEntries}>
        {pending.map((entry) => (
          <EntryDecision
            key={entry.itemSourceReferenceId}
            entry={entry}
            decision={decisions[entry.itemSourceReferenceId]}
            onDecide={(decision) => onDecide(entry.itemSourceReferenceId, decision)}
          />
        ))}
      </ul>
      {!!plan.excluded.length && (
        <div className={styles.rebaseExcluded}>
          <h3>Cannot be rebased</h3>
          <ul>
            {plan.excluded.map((excluded) => (
              <li key={excluded.itemSourceReferenceId}>
                {REBASE_EXCLUSION_EXPLANATION[excluded.reason]}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ScreenplayRebasePreviewDialog({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const plan = useQuery({
    queryKey: screenplayRebasePreviewQueryKey(projectId),
    queryFn: ({ signal }) =>
      api<ScreenplayRebasePlan>(`/api/v1/projects/${projectId}/screenplay-rebase-preview`, {
        signal,
      }),
    // A preview is a read of live text: never served from a stale cache, never retried into a loop.
    staleTime: 0,
    retry: false,
  });

  const queries = useQueryClient();
  const apply = useMutation({
    mutationFn: (body: ApplyScreenplayRebaseInput) =>
      api<ScreenplayRebaseApplyResult>(`/api/v1/projects/${projectId}/screenplay-rebase`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      // Every pinned reference in the breakdown may now resolve to different text, and the plan that
      // was just applied is spent, so nothing cached about either survives.
      await queries.invalidateQueries({ queryKey: screenplayRebasePreviewQueryKey(projectId) });
      await queries.invalidateQueries({ queryKey: ['items', projectId] });
      onClose();
    },
    retry: false,
  });

  const pending = plan.data?.entries.filter((entry) => entry.decisionRequired) ?? [];
  const recorded = pending.filter((entry) => decisions[entry.itemSourceReferenceId]).length;
  // Nothing may be applied until every reviewable range has an answer. The server enforces this too;
  // offering a control the API would reject is what this repo's link state already refuses to do.
  const ready = !!plan.data && recorded === pending.length && !apply.isPending;

  return (
    <ModalShell
      config={{
        size: 'large',
        regions: {
          header: { title: 'Review screenplay rebase' },
          body: {
            description: (
              <p>
                How every pinned range would re-anchor onto the current screenplay. Reviewing
                changes nothing — applying is a separate step.
              </p>
            ),
            content: (
              <>
                {plan.isLoading && (
                  <SkeletonGroup label="Loading rebase preview" className={styles.listSkeleton}>
                    {Array.from({ length: 4 }, (_unused, index) => (
                      <div key={index}>
                        <Skeleton width="42%" height={9} />
                        <Skeleton width="88%" height={10} />
                      </div>
                    ))}
                  </SkeletonGroup>
                )}
                {!plan.isLoading && plan.error && (
                  <div className={styles.panelQueryState} role="alert">
                    <span>The rebase preview could not be loaded.</span>
                    <button
                      type="button"
                      className={styles.queryStateAction}
                      onClick={() => void plan.refetch()}
                    >
                      Retry
                    </button>
                  </div>
                )}
                {!plan.isLoading && !plan.error && plan.data && (
                  <PlanBody
                    plan={plan.data}
                    decisions={decisions}
                    onDecide={(referenceId, decision) =>
                      setDecisions((current) => ({ ...current, [referenceId]: decision }))
                    }
                  />
                )}
              </>
            ),
          },
          footer: (
            <>
              <span className={styles.rebaseFooterCount}>
                {recorded} of {pending.length} decisions recorded
              </span>
              {apply.error && (
                <span className={styles.rebaseFooterError} role="alert">
                  The rebase was not applied. The screenplay may have changed — reopen this dialog
                  to review it again.
                </span>
              )}
              <button type="button" className={modalButtonStyles.secondary} onClick={onClose}>
                Close
              </button>
              <button
                type="button"
                className={modalButtonStyles.primary}
                disabled={!ready}
                onClick={() => {
                  if (plan.data) apply.mutate(rebaseApplyBody(plan.data, decisions));
                }}
              >
                {apply.isPending ? 'Applying…' : 'Apply rebase'}
              </button>
            </>
          ),
        },
        dismissal: { onDismiss: onClose, closeButton: true, escape: true, backdrop: true },
      }}
    />
  );
}
