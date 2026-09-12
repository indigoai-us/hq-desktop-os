import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderOpen, RefreshCw, Wrench, Settings, ArrowUpRight, Plus, Check, Trash2, Terminal, ArrowRight, Laptop } from 'lucide-react';
import { activeWorkspace, type CompanionAction, type CompanionSnapshot } from '../shared/companion';
import { HEALTH_PREVIEW_FIXTURES } from '../shared/health-fixtures';
import { createCompanionClient, type CompanionClient } from './companion-client';
import { HqMark } from './components/hq-mark';
import { Button } from './components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './components/ui/dialog';
import { AccountScreen } from './screens/account';
import { SettingsScreen } from './screens/settings';
import { SetupScreen } from './screens/setup';
import { SyncScreen } from './screens/sync';

const sections = [{ name: 'Workspace', icon: FolderOpen }, { name: 'Sync', icon: RefreshCw }, { name: 'Tools', icon: Wrench }, { name: 'Settings', icon: Settings }] as const;
type Section = typeof sections[number]['name'];
type ScreenState = 'empty' | 'loading' | 'error' | 'populated';

function workspaceScreenState(input: {
  state?: CompanionSnapshot;
  error: string;
  setupRunning: boolean;
  workspace: ReturnType<typeof activeWorkspace>;
}): ScreenState {
  const { state, error, setupRunning, workspace } = input;
  if (!state && !error) return 'loading';
  if (error && !state) return 'error';
  if (state?.setup && !state.setup.complete) {
    if (state.setup.error) return 'error';
    if (setupRunning) return 'loading';
    return 'populated';
  }
  if (!workspace) return 'empty';
  return 'populated';
}

function syncScreenState(input: {
  state?: CompanionSnapshot;
  error: string;
  pending: string;
  workspace: ReturnType<typeof activeWorkspace>;
  connected: boolean;
}): ScreenState {
  const { state, error, pending, workspace, connected } = input;
  if (!state && !error) return 'loading';
  if (error) return 'error';
  if (pending) return 'loading';
  if (state?.sync.phase === 'error') return 'error';
  if (!workspace || !connected) return 'empty';
  return 'populated';
}

function toolsScreenState(input: {
  state?: CompanionSnapshot;
  error: string;
  pending: string;
  workspace: ReturnType<typeof activeWorkspace>;
}): ScreenState {
  const { state, error, pending, workspace } = input;
  if (!state && !error) return 'loading';
  if (error) return 'error';
  if (pending) return 'loading';
  if (!workspace) return 'empty';
  return 'populated';
}

function settingsScreenState(input: {
  state?: CompanionSnapshot;
  error: string;
  pending: string;
}): ScreenState {
  const { state, error, pending } = input;
  if (!state && !error) return 'loading';
  if (!state && error) return 'error';
  if (pending) return 'loading';
  return 'populated';
}

export function CompanionApp() {
  const [section, setSection] = useState<Section>('Workspace');
  const [client, setClient] = useState<CompanionClient>();
  const [state, setState] = useState<CompanionSnapshot>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState('');
  const busy = useRef(false);
  const requestVersion = useRef(0);
  const [removeId, setRemoveId] = useState<string>();
  useEffect(() => {
    let active = true;
    void createCompanionClient().then(async (adapter) => {
      if (!active) return;
      setClient(adapter);
      try { const snapshot = await adapter.request({ action: 'snapshot' }); if (active) setState(snapshot); }
      catch (cause) { console.error('Workspace state could not be loaded', cause instanceof Error ? cause.name : 'unknown'); if (active) setError('We could not open your workspace. Try reopening the app.'); }
    }).catch(() => { if (active) setError('Open HQ on your computer to get started.'); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!client) return;
    let active = true; let reading = false;
    const timer = setInterval(() => {
      if (busy.current || reading) return;
      reading = true; const version = requestVersion.current;
      void client.request({ action: 'snapshot' }).then(snapshot => {
        if (active && version === requestVersion.current) setState(snapshot);
      }).catch((cause: unknown) => { console.error('HQ status refresh failed', cause instanceof Error ? cause.name : 'unknown'); }).finally(() => { reading = false; });
    }, 1000);
    return () => { active = false; clearInterval(timer); };
  }, [client]);
  const run = useCallback(async (action: CompanionAction, label: string) => {
    if (!client || busy.current) return;
    requestVersion.current++; busy.current = true; setPending(label); setError('');
    try { setState(await client.request(action)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'That did not finish. Please try again.'); }
    finally { busy.current = false; setPending(''); }
  }, [client]);
  const workspace = state && activeWorkspace(state);
  const setupRunning = !!state?.setup?.steps.some(step => step.status === 'working');
  const signingIn = state?.account.status === 'signing-in';
  const enabled = !!state && !pending && !setupRunning && !signingIn;
  const attach = () => void run({ action: 'attach-workspace' }, 'Choosing your folder');
  const connected = state?.account.status === 'connected';
  const workspaceLabel = workspace?.name ?? 'Let’s get you set up';
  const screenStates = {
    Workspace: workspaceScreenState({ state, error, setupRunning, workspace }),
    Sync: syncScreenState({ state, error, pending, workspace, connected }),
    Tools: toolsScreenState({ state, error, pending, workspace }),
    Settings: settingsScreenState({ state, error, pending }),
  } as const;
  return <div className="companion-shell" data-testid="companion-shell">
    <aside className="companion-sidebar" aria-label="Desktop navigation">
      <HqMark className="brand-mark" />
      <nav aria-label="Companion">
        {sections.map(({ name, icon: Icon }) => <button key={name} className="hq-button hq-nav-item" data-testid={name === 'Workspace' ? 'selected-sample' : `nav-${name.toLowerCase()}`} data-selected={section === name} aria-current={section === name ? 'page' : undefined} onClick={() => setSection(name)}><Icon size={17}/>{name}</button>)}
      </nav>
      <div className="sidebar-footer" data-testid="active-workspace" data-workspace={workspace?.id ?? ''}><Laptop size={15}/>This computer<span>{workspaceLabel}</span></div>
    </aside>
    <main className="companion-main" data-focus-shell tabIndex={-1} aria-busy={!!pending} data-active-section={section}>
      {/* DEV-only: Vite DCE drops this fixture chrome from production bundles. */}
      {import.meta.env.DEV && client?.simulated && (
        <div role="status" className="notice" data-testid="preview-simulated-banner">
          Preview · Changes here are not saved.{' '}
          <Button
            variant="ghost"
            data-testid="preview-reset"
            onClick={() => {
              // Drop scenario selection and reload so fixtures restart from signed-out.
              window.location.assign('/dev/companion');
            }}
          >
            Reset preview
          </Button>
        </div>
      )}
      {error && <div role="alert" className="notice error" data-testid="companion-error">{error}<Button variant="ghost" onClick={() => void run({ action: 'snapshot' }, 'Trying again')}>Try again</Button></div>}
      {state?.account.error && <p role="alert" className="notice error">{state.account.error}</p>}
      {signingIn && <div role="status" className="notice">Finish signing in through your browser.<Button variant="ghost" disabled={!!pending} onClick={() => void run({ action: 'cancel-sign-in' }, 'Canceling sign-in')}>Cancel sign-in</Button></div>}
      {pending && <p role="status" className="notice" data-testid="companion-pending">{pending}…</p>}
      {!state && !error && <p role="status" data-testid="companion-loading">Opening HQ…</p>}
      {section === 'Workspace' && state?.setup && !state.setup.complete ? (
        <SetupScreen
          setup={state.setup}
          setupRunning={setupRunning}
          pending={pending}
          run={run}
          screenState={screenStates.Workspace}
        />
      ) : section === 'Workspace' && !workspace ? <section className="welcome" data-screen="Workspace" data-screen-state={screenStates.Workspace} data-testid="screen-workspace">
        <HqMark className="welcome-mark"/>
        <h1>Your work, right here.</h1>
        <p className="lead">Set up HQ on this computer and bring your files and team together.</p>
        <div className="welcome-actions"><Button disabled={!enabled} data-testid="action-create-workspace" onClick={() => void run({ action: 'create-workspace' }, 'Preparing your workspace')}>Set up HQ<ArrowRight size={16}/></Button><Button variant="ghost" disabled={!enabled} onClick={attach}>I already have an HQ folder</Button></div>
        <ol className="setup-steps">
          <li><span className="step-symbol">1</span><div><h2>Make yourself at home</h2><p>Choose where your work lives on this computer.</p></div></li>
          <li><span className="step-symbol">2</span><div><h2>Connect your account</h2><p>Sign in to find your team and shared work.</p></div></li>
          <li><span className="step-symbol">3</span><div><h2>Pick up where you left off</h2><p>Keep your files up to date across your devices.</p></div></li>
        </ol>
      </section> : section === 'Workspace' && <div data-screen="Workspace" data-screen-state={screenStates.Workspace} data-testid="screen-workspace">
        <header className="page-heading"><h1>Your workspace</h1><p className="lead">A home for your work on this computer.</p></header>
        <section className="content-section"><div className="section-heading"><h2>Folders</h2><Button variant="ghost" disabled={!enabled} onClick={attach}><Plus size={15}/>Add a folder</Button></div>
          <ul className="workspace-list">{state?.workspaces.map((item) => <li key={item.id} data-selected={item.id === state.activeWorkspaceId}><button className="workspace-choice" aria-pressed={item.id === state.activeWorkspaceId} disabled={!enabled} onClick={() => void run({ action: 'select-workspace', workspaceId: item.id }, 'Switching workspace')}><FolderOpen size={22}/><span><span>{item.name}</span><span className="muted workspace-path">{item.root}</span></span>{item.id === state.activeWorkspaceId && <Check size={16}/>}</button><Button variant="ghost" size="icon" aria-label={`Remove ${item.name} from app`} disabled={!enabled} onClick={() => setRemoveId(item.id)}><Trash2 size={15}/></Button></li>)}</ul>
          <div className="welcome-actions"><Button disabled={!enabled} onClick={() => void run({ action: 'open-folder', workspaceId: workspace!.id }, 'Opening your files')}><FolderOpen size={16}/>Open your files</Button></div>
        </section>
        {state && (
          <AccountScreen state={state} enabled={enabled} connected={connected} run={run} />
        )}
      </div>}
      {section === 'Sync' && state && (
        <SyncScreen
          state={state}
          workspaceName={workspace?.name}
          connected={connected}
          enabled={enabled}
          screenState={screenStates.Sync}
          onGoWorkspace={() => setSection('Workspace')}
          run={run}
        />
      )}
      {section === 'Sync' && !state && (
        <div data-screen="Sync" data-screen-state={screenStates.Sync} data-testid="screen-sync">
          <header className="page-heading"><h1>Sync</h1><p className="lead">Your latest work, wherever you need it.</p></header>
          <p role="status" className="notice">{error ? 'Sync will be available after HQ reconnects.' : 'Loading sync…'}</p>
        </div>
      )}
      {section === 'Tools' && <div data-screen="Tools" data-screen-state={screenStates.Tools} data-testid="screen-tools">
        <header className="page-heading"><h1>Tools</h1><p className="lead">A few shortcuts for your workspace.</p></header>
        {!workspace && <p className="notice" data-testid="tools-empty">Choose your workspace first to use these shortcuts.</p>}
        <section>{[{ title: 'Files', description: 'Browse and organize your work.', action: 'open-folder' as const, icon: FolderOpen }, { title: 'Terminal', description: 'For when you want to work with commands.', action: 'open-terminal' as const, icon: Terminal }].map(({ title, description, action, icon: Icon }) => <div className="tool-row" key={title}><Icon size={22}/><div><h2>{title}</h2><p>{description}</p></div><Button variant="ghost" disabled={!enabled || !workspace} onClick={() => void run({ action, workspaceId: workspace!.id }, `Opening ${title.toLowerCase()}`)}>Open {title.toLowerCase()}<ArrowUpRight size={15}/></Button></div>)}</section>
      </div>}
      {section === 'Settings' && !state && (
        <section data-screen="Settings" data-screen-state={screenStates.Settings} data-testid="screen-settings" aria-label="Settings">
          <header className="page-heading"><h1>Settings</h1><p className="lead">Make HQ feel at home.</p></header>
          <p role="status" className="notice">{error ? 'Settings will be available after HQ reconnects.' : 'Loading settings…'}</p>
        </section>
      )}
      {section === 'Settings' && state && (
        <div data-screen="Settings" data-screen-state={screenStates.Settings} data-testid="screen-settings">
          <SettingsScreen
            state={state}
            health={state.health ?? HEALTH_PREVIEW_FIXTURES.unavailable}
            enabled={enabled}
            connected={connected}
            run={run}
          />
        </div>
      )}
      <Dialog open={!!removeId} onOpenChange={(open) => { if (!open) setRemoveId(undefined); }}><DialogContent><DialogTitle>Remove this workspace?</DialogTitle><DialogDescription>Your folder and its files will stay on this computer. You can add it again anytime.</DialogDescription><div className="dialog-actions"><Button variant="outline" onClick={() => setRemoveId(undefined)}>Keep workspace</Button><Button onClick={() => { const id = removeId!; setRemoveId(undefined); void run({ action: 'remove-workspace', workspaceId: id }, 'Removing workspace'); }}>Remove from app</Button></div></DialogContent></Dialog>
    </main>
  </div>;
}
