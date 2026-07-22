import type { PanelContentProps } from './types';
import { EntityTablePanel } from './EntityTablePanel';
import { InspectorPanel } from './InspectorPanel';
import { PdfPanel } from './PdfPanel';
import { ActivityPanel } from './ActivityPanel';
import { TrashPanel } from './TrashPanel';

export function PanelContent(props: PanelContentProps) {
  if (props.panel.type === 'entity_table')
    return <EntityTablePanel {...props} panel={props.panel} />;
  if (props.panel.type === 'inspector') return <InspectorPanel {...props} panel={props.panel} />;
  if (props.panel.type === 'pdf') return <PdfPanel {...props} panel={props.panel} />;
  if (props.panel.type === 'activity') return <ActivityPanel {...props} panel={props.panel} />;
  return <TrashPanel {...props} panel={props.panel} />;
}
