import { useMemo, type ReactNode } from 'react';
import type { ScreenplayContextModel } from './screenplay-context-model';
import type { ScreenplayPreviewModel } from './screenplay-preview-model';
import {
  buildScreenplayStatistics,
  formatStatisticPercent,
  type ScreenplayStatisticShare,
  type ScreenplayStatisticsModel,
} from './screenplay-statistics-model';
import styles from './ScreenplayStatisticsPanel.module.css';

export type ScreenplayStatisticsView =
  | 'overview'
  | 'characters'
  | 'scenes'
  | 'locations'
  | 'structure';

interface ScreenplayStatisticsPanelProps {
  source: string;
  context: ScreenplayContextModel;
  preview: ScreenplayPreviewModel;
  onReveal: (sourceOffset: number) => void;
  view?: ScreenplayStatisticsView;
}

export function ScreenplayStatisticsPanel({
  source,
  context,
  preview,
  onReveal,
  view = 'overview',
}: ScreenplayStatisticsPanelProps) {
  const model = useMemo(
    () => buildScreenplayStatistics(source, context, preview),
    [context, preview, source],
  );
  return (
    <div className={styles.panel}>
      <div className={styles.body}>
        {view === 'overview' && <Overview model={model} />}
        {view === 'characters' && <Characters model={model} onReveal={onReveal} />}
        {view === 'scenes' && <Scenes model={model} onReveal={onReveal} />}
        {view === 'locations' && <Locations model={model} onReveal={onReveal} />}
        {view === 'structure' && <Structure model={model} onReveal={onReveal} />}
      </div>
    </div>
  );
}

function Overview({ model }: { model: ScreenplayStatisticsModel }) {
  const totals = [
    ['Pages', model.totals.pages],
    ['Scenes', model.totals.scenes],
    ['Words', model.totals.words],
    ['Speakers', model.totals.speakingCharacters],
    ['Locations', model.totals.locations],
    ['Dialogue blocks', model.totals.dialogueBlocks],
    ['Est. read', `${model.readingEstimates.estimatedReadingMinutes.toFixed(1)} min`],
    ['Dialogue', formatStatisticPercent(model.dialogueActionBalance.dialogueShare)],
  ] as const;
  return (
    <>
      <section className={styles.metricGrid} aria-label="Screenplay totals">
        {totals.map(([label, value]) => (
          <div key={label} className={styles.metric}>
            <strong>{value.toLocaleString()}</strong>
            <span>{label}</span>
          </div>
        ))}
      </section>
      <StatSection title="Writing balance" note="Share of parsed printable words">
        <ShareBars items={model.writingBalance} />
      </StatSection>
      <StatSection title="Reading estimates" note="Heuristic rates, not screen duration">
        <dl className={styles.definitionGrid}>
          <Definition label="Silent read" value={`${model.readingEstimates.estimatedReadingMinutes.toFixed(2)} min`} />
          <Definition label="Spoken dialogue" value={`${model.readingEstimates.estimatedDialogueMinutes.toFixed(2)} min`} />
          <Definition label="Reading rate" value={`${String(model.readingEstimates.readingWordsPerMinute)} wpm`} />
          <Definition label="Speaking rate" value={`${String(model.readingEstimates.speakingWordsPerMinute)} wpm`} />
        </dl>
      </StatSection>
      <StatSection title="Structural observations" note="Descriptive, not story judgment">
        <ul className={styles.observations}>
          {model.observations.map((observation) => (
            <li key={observation}>{observation}</li>
          ))}
        </ul>
      </StatSection>
      <HeuristicNote />
    </>
  );
}

function Characters({
  model,
  onReveal,
}: {
  model: ScreenplayStatisticsModel;
  onReveal: (offset: number) => void;
}) {
  return (
    <>
      <StatSection title="Dialogue share" note="Cue-based speaking appearances">
        <div className={styles.rankedList}>
          {model.characters.map((character) => (
            <button
              key={character.id}
              type="button"
              className={styles.rankRow}
              onClick={() => onReveal(character.sourceOffset)}
            >
              <span className={styles.rowHeading}>
                <strong>{character.name}</strong>
                <b>{formatStatisticPercent(character.dialogueShare)}</b>
              </span>
              <span className={styles.track} aria-hidden="true">
                <span style={{ width: barWidth(character.dialogueShare) }} />
              </span>
              <small>
                {character.dialogueWordCount.toLocaleString()} words ·{' '}
                {String(character.speakingSceneCount)} speaking scenes (
                {formatStatisticPercent(character.speakingSceneShare)})
              </small>
              <small>
                {String(character.cueCount)} cues · {String(character.dialogueBlockCount)} blocks ·{' '}
                {String(character.dialogueLineCount)} dialogue lines ·{' '}
                {character.dialogueWordsPerSpeakingScene.toFixed(1)} words/speaking scene · scenes{' '}
                {String(character.firstScene)}–{String(character.lastScene)}
              </small>
              <small>
                Est. presence {String(character.estimatedAppearanceSceneCount)} scenes ·{' '}
                {formatStatisticPercent(character.estimatedAppearanceSceneShare)}
              </small>
              <small>
                Avg {character.averageDialogueWords.toFixed(1)} words/block · est. speaking{' '}
                {character.estimatedSpeakingMinutes.toFixed(2)} min at 130 wpm
              </small>
            </button>
          ))}
          {!model.characters.length && <EmptyState label="No character cues found." />}
        </div>
      </StatSection>
      <HeuristicNote>
        Speaking scenes are cue-based; estimated presence also scans exact character-name mentions
        in action and does not prove physical presence.
      </HeuristicNote>
    </>
  );
}

function Scenes({
  model,
  onReveal,
}: {
  model: ScreenplayStatisticsModel;
  onReveal: (offset: number) => void;
}) {
  const pacing = model.pacing;
  return (
    <>
      <section className={styles.metricGrid} aria-label="Scene pacing summary">
        <Metric value={pacing.averageScenePages.toFixed(2)} label="Avg est. pages" />
        <Metric value={pacing.medianScenePages.toFixed(2)} label="Median est. pages" />
        <Metric value={pacing.averageSceneWords.toFixed(0)} label="Avg words" />
        <Metric value={String(pacing.dialogueFreeSceneCount)} label="No dialogue" />
      </section>
      <StatSection title="Scene lengths" note="Short <0.5 page · long >2 pages">
        <div className={styles.sceneList}>
          {model.scenes.map((scene) => (
            <button
              key={scene.id}
              type="button"
              className={styles.sceneRow}
              onClick={() => onReveal(scene.sourceOffset)}
            >
              <span className={styles.sceneNumber}>{String(scene.index).padStart(2, '0')}</span>
              <span className={styles.sceneText}>
                <strong>{scene.heading}</strong>
                <small>
                  {scene.estimatedPages.toFixed(2)} est. pages · {String(scene.wordCount)} words ·{' '}
                  {String(scene.speakingCharacterCount)} speakers
                </small>
                <small>
                  Est. {scene.estimatedDurationSeconds.toFixed(0)} sec · dialogue density{' '}
                  {formatStatisticPercent(scene.dialogueDensity)}
                </small>
              </span>
              <span className={styles.tags}>
                <em data-tone={scene.lengthBand}>{scene.lengthBand}</em>
                {scene.dialogueFree && <em>no dialogue</em>}
                {scene.actionHeavy && <em>action-heavy</em>}
                {scene.outlier && <em>{scene.outlier} outlier</em>}
              </span>
            </button>
          ))}
          {!model.scenes.length && <EmptyState label="No scene headings found." />}
        </div>
      </StatSection>
      <HeuristicNote />
    </>
  );
}

function Locations({
  model,
  onReveal,
}: {
  model: ScreenplayStatisticsModel;
  onReveal: (offset: number) => void;
}) {
  return (
    <>
      <StatSection title="Location share" note="Share of parsed scene headings">
        <ShareBars items={model.locations} unit="scenes" onReveal={onReveal} />
      </StatSection>
      <section className={styles.metricGrid} aria-label="Location reuse summary">
        <Metric value={String(model.locationReuse.reusedLocationCount)} label="Reused locations" />
        <Metric value={String(model.locationReuse.singleUseLocationCount)} label="Single use" />
        <Metric
          value={model.locationReuse.averageScenesPerLocation.toFixed(1)}
          label="Avg scenes/location"
        />
        <Metric
          value={formatStatisticPercent(model.locationReuse.reuseRate)}
          label="Reuse rate"
        />
      </section>
      <StatSection title="Interior / exterior" note="Parsed heading prefixes">
        <ShareBars items={model.settings} unit="scenes" />
      </StatSection>
      <StatSection title="Time of day" note="Text after the final heading separator">
        <ShareBars items={model.timesOfDay} unit="scenes" onReveal={onReveal} />
      </StatSection>
      <HeuristicNote>
        Locations and times are normalized from scene-heading syntax only.
      </HeuristicNote>
    </>
  );
}

function Structure({
  model,
  onReveal,
}: {
  model: ScreenplayStatisticsModel;
  onReveal: (offset: number) => void;
}) {
  const pacing = model.pacing;
  return (
    <>
      <StatSection title="Pacing distribution" note="Layout-based page equivalents">
        <dl className={styles.definitionGrid}>
          <div>
            <dt>Shortest</dt>
            <dd>{pacing.minimumScenePages.toFixed(2)} pages</dd>
          </div>
          <div>
            <dt>Longest</dt>
            <dd>{pacing.maximumScenePages.toFixed(2)} pages</dd>
          </div>
          <div>
            <dt>Short</dt>
            <dd>{String(pacing.shortSceneCount)} scenes</dd>
          </div>
          <div>
            <dt>Standard</dt>
            <dd>{String(pacing.standardSceneCount)} scenes</dd>
          </div>
          <div>
            <dt>Long</dt>
            <dd>{String(pacing.longSceneCount)} scenes</dd>
          </div>
          <div>
            <dt>Action-heavy</dt>
            <dd>{String(pacing.actionHeavySceneCount)} scenes</dd>
          </div>
        </dl>
      </StatSection>
      <StatSection title="Character co-occurrence" note="Speaking together in the same scene">
        <div className={styles.pairList}>
          {model.coOccurrences.slice(0, 20).map((pair) => (
            <div key={pair.id}>
              <strong>
                {pair.firstCharacter} + {pair.secondCharacter}
              </strong>
              <span>
                {String(pair.sharedSceneCount)} scenes ·{' '}
                {formatStatisticPercent(pair.sharedSceneShare)}
              </span>
            </div>
          ))}
          {!model.coOccurrences.length && <EmptyState label="No shared speaking scenes found." />}
        </div>
      </StatSection>
      <StatSection title="Structural consistency" note="Syntax-derived checks, not story judgment">
        <div className={styles.checkList}>
          {model.structuralChecks.map((check) => (
            <div key={check.id} data-status={check.status}>
              <span>
                <strong>{check.label}</strong>
                <small>{check.detail}</small>
              </span>
              <b>{check.status === 'pass' ? 'PASS' : String(check.count)}</b>
            </div>
          ))}
        </div>
      </StatSection>
      <StatSection title="Repeated language" note="Exact normalized words and 2–3 word phrases">
        <RepeatedText items={model.repeatedWords} onReveal={onReveal} empty="No repeated words." />
        <RepeatedText items={model.repeatedPhrases} onReveal={onReveal} empty="No repeated phrases." />
      </StatSection>
      <HeuristicNote />
    </>
  );
}

function Definition({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function RepeatedText({
  items,
  onReveal,
  empty,
}: {
  items: ScreenplayStatisticsModel['repeatedWords'];
  onReveal: (offset: number) => void;
  empty: string;
}) {
  if (!items.length) return <EmptyState label={empty} />;
  return (
    <div className={styles.termList}>
      {items.map((item) => (
        <button key={item.id} type="button" onClick={() => onReveal(item.sourceOffset)}>
          <strong>{item.text}</strong>
          <span>{String(item.count)}×</span>
        </button>
      ))}
    </div>
  );
}

function StatSection({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <header>
        <strong>{title}</strong>
        <small>{note}</small>
      </header>
      {children}
    </section>
  );
}

function ShareBars({
  items,
  unit = 'words',
  onReveal,
}: {
  items: readonly ScreenplayStatisticShare[];
  unit?: string;
  onReveal?: (offset: number) => void;
}) {
  return (
    <div className={styles.shareList}>
      {items.map((item) => {
        const content = (
          <>
          <span className={styles.rowHeading}>
            <strong>{item.label}</strong>
            <b>{formatStatisticPercent(item.share)}</b>
          </span>
          <span className={styles.track} aria-hidden="true">
            <span style={{ width: barWidth(item.share) }} />
          </span>
          <small>
            {item.count.toLocaleString()} {unit}
          </small>
          </>
        );
        return onReveal && item.sourceOffset !== undefined ? (
          <button
            key={item.id}
            type="button"
            className={`${styles.shareRow} ${styles.shareRowButton}`}
            onClick={() => onReveal(item.sourceOffset!)}
          >
            {content}
          </button>
        ) : (
          <div key={item.id} className={styles.shareRow}>
            {content}
          </div>
        );
      })}
      {!items.length && <EmptyState label="No structured data found." />}
    </div>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className={styles.metric}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <p className={styles.empty}>{label}</p>;
}

function HeuristicNote({ children }: { children?: ReactNode }) {
  return (
    <p className={styles.heuristic}>
      {children ??
        'Page-equivalent and runtime figures are layout-based estimates; one page ≈ one minute is only a planning heuristic.'}
    </p>
  );
}

function barWidth(share: number): string {
  return `${Math.min(100, Math.max(0, share * 100)).toFixed(2)}%`;
}
