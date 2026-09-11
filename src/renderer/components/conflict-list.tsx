import type { ConflictChoice } from '../../shared/companion';
import { Button } from './ui/button';

const choices: { choice: ConflictChoice; label: string; detail: string; emphasize?: boolean }[] = [
  { choice: 'keep', label: 'Keep both versions', detail: 'Preserve your local copy and the cloud copy.' },
  { choice: 'publish-local', label: 'Use my local copy', detail: 'Publish this computer’s version to the cloud.' },
  { choice: 'overwrite', label: 'Use the cloud copy', detail: 'Replace your local file with the cloud version. Never chosen for you.' },
  { choice: 'abort', label: 'Stop sync', detail: 'Pause sync and leave these files unresolved.' },
];

export function ConflictList(props: {
  paths: string[];
  disabled?: boolean;
  onResolve: (choice: ConflictChoice) => void;
}) {
  const { paths, disabled, onResolve } = props;
  if (!paths.length) return null;
  return (
    <section className="conflict-panel" aria-label="Files that need a choice">
      <h3>{paths.length === 1 ? 'This file needs a choice' : `${paths.length} files need a choice`}</h3>
      <ul className="conflict-paths">
        {paths.map((path) => <li key={path}><code>{path}</code></li>)}
      </ul>
      <div className="conflict-actions">
        {choices.map(({ choice, label, detail }) => (
          <div key={choice} className="conflict-action">
            <Button
              variant={choice === 'overwrite' ? 'outline' : choice === 'abort' ? 'ghost' : 'default'}
              disabled={disabled}
              onClick={() => onResolve(choice)}
            >
              {label}
            </Button>
            <p>{detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
