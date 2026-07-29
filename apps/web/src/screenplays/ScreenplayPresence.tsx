import { UsersThreeIcon } from '@phosphor-icons/react/dist/csr/UsersThree';
import type { CSSProperties } from 'react';
import type { ScreenplayCollaborator } from './screenplay-collaboration-session';
import styles from './ScreenplayPresence.module.css';

function uniqueMembers(collaborators: readonly ScreenplayCollaborator[]) {
  const members = new Map<string, ScreenplayCollaborator>();
  for (const collaborator of collaborators) {
    const current = members.get(collaborator.userId);
    if (!current || collaborator.isLocal) members.set(collaborator.userId, collaborator);
  }
  return [...members.values()];
}

export function ScreenplayPresence({
  collaborators,
}: {
  collaborators: readonly ScreenplayCollaborator[];
}) {
  const members = uniqueMembers(collaborators);
  const visible = members.slice(0, 4);
  const hidden = members.length - visible.length;
  return (
    <div className={styles.presence} aria-label={`${String(members.length)} collaborators present`}>
      <UsersThreeIcon aria-hidden="true" size={13} />
      {visible.map((member) => (
        <span
          key={member.userId}
          className={styles.chip}
          style={{ '--collaborator-color': member.color } as CSSProperties}
          title={`${member.displayName}${member.isLocal ? ' (you)' : ''}`}
        >
          <span className={styles.dot} aria-hidden="true" />
          {member.displayName}
          {member.isLocal ? ' (You)' : ''}
        </span>
      ))}
      {hidden > 0 && (
        <span className={styles.overflow} aria-label={`${String(hidden)} more collaborators`}>
          +{hidden}
        </span>
      )}
    </div>
  );
}
