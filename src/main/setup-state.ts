import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface SetupStep {
  id: 'content' | 'dependencies' | 'personalize';
  label: string;
  status: 'waiting' | 'working' | 'ready' | 'error';
}

export interface SetupState {
  id: string;
  root: string;
  steps: SetupStep[];
  error: string | null;
  complete: boolean;
}

export function initialSetup(root: string): SetupState {
  return {
    id: randomUUID(),
    root,
    complete: false,
    error: null,
    steps: [
      { id: 'content', label: 'Getting your workspace ready', status: 'waiting' },
      { id: 'dependencies', label: 'Preparing this computer', status: 'waiting' },
      { id: 'personalize', label: 'Adding the finishing touches', status: 'waiting' },
    ],
  };
}

/** Marks in-flight steps as retryable after an app crash or forced quit. */
export function recoverInterruptedSetup(state: SetupState): SetupState {
  const steps = state.steps.map((step) => (
    step.status === 'working' ? { ...step, status: 'error' as const } : step
  ));
  const interrupted = steps.some((step, index) => step.status === 'error' && state.steps[index]?.status === 'working');
  return {
    ...state,
    steps,
    complete: false,
    error: interrupted
      ? (state.error ?? 'Setup stopped unexpectedly. Completed steps were kept; continue to retry the rest.')
      : state.error,
  };
}

/** Durable setup journal under userData. Atomic write; corrupt state refuses to resume blindly. */
export class SetupJournal {
  constructor(private readonly file: string) {}

  async clear(): Promise<void> {
    await rm(this.file, { force: true });
  }

  async save(state: SetupState): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    await writeFile(`${this.file}.tmp`, JSON.stringify(state), { mode: 0o600 });
    await rename(`${this.file}.tmp`, this.file);
  }

  async load(): Promise<SetupState | undefined> {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8')) as SetupState;
      if (
        !data
        || typeof data.id !== 'string'
        || typeof data.complete !== 'boolean'
        || typeof data.root !== 'string'
        || !Array.isArray(data.steps)
        || data.steps.length !== 3
        || !data.steps.every((step) => (
          ['content', 'dependencies', 'personalize'].includes(step.id)
          && ['waiting', 'working', 'ready', 'error'].includes(step.status)
        ))
      ) {
        throw new Error('Your saved setup could not be read. Please restart setup.');
      }
      return data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }
}
