import { BookOpenTextIcon } from '@phosphor-icons/react/dist/csr/BookOpenText';
import { CaretUpDownIcon } from '@phosphor-icons/react/dist/csr/CaretUpDown';
import { MenuBar } from '../app-shell/menu-bar';
import appStyles from '../App.styles';
import { screenplayMenuBarModel, type ScreenplayMenuContext } from './screenplay-menu';
import styles from './ScreenplayMenuBar.module.css';

export type ScreenplayMenuBarProps = ScreenplayMenuContext;

function ScreenplayBrand({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" onClick={onBack} className={appStyles.brand}>
      <span className={appStyles.logoMark} aria-hidden="true" />
      <span className={appStyles.visuallyHidden}>Back to screenplays</span>
    </button>
  );
}

function DocumentIdentity({ title, filename }: { title: string; filename: string }) {
  return (
    <div className={styles.documentIdentity} title={`${title} · ${filename}`}>
      <BookOpenTextIcon size={13} aria-hidden="true" />
      <span>{title}</span>
      <small>{filename}</small>
      <CaretUpDownIcon size={12} aria-hidden="true" />
    </div>
  );
}

export function ScreenplayMenuBar(props: ScreenplayMenuBarProps) {
  return (
    <MenuBar
      model={screenplayMenuBarModel}
      context={props}
      className={styles.masthead}
      trailingClassName={styles.documentIdentitySlot}
      popupClassName={styles.menuPopup}
      leading={<ScreenplayBrand onBack={props.onBack} />}
      trailing={<DocumentIdentity title={props.title} filename={props.filename} />}
    />
  );
}
