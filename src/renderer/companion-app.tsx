import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderOpen, RefreshCw, Wrench, Settings, ArrowUpRight, Plus, Check, Trash2, Terminal, ArrowRight, UserRound, Cloud, Laptop } from 'lucide-react';
import { activeWorkspace, type CompanionAction, type CompanionSnapshot, type ConflictChoice } from '../shared/companion';
import { HEALTH_PREVIEW_FIXTURES } from '../shared/health-fixtures';
import { createCompanionClient, type CompanionClient } from './companion-client';
import { HqMark } from './components/hq-mark';
import { ConflictList } from './components/conflict-list';
import { Button } from './components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './components/ui/dialog';
import { SettingsScreen } from './screens/settings';

const sections = [{ name: 'Workspace', icon: FolderOpen }, { name: 'Sync', icon: RefreshCw }, { name: 'Tools', icon: Wrench }, { name: 'Settings', icon: Settings }] as const;
type Section = typeof sections[number]['name'];
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
  return <div className="companion-shell">
    <aside className="companion-sidebar" aria-label="Desktop navigation">
      <HqMark className="brand-mark" />
      <nav aria-label="Companion">
        {sections.map(({ name, icon: Icon }) => <button key={name} className="hq-button hq-nav-item" data-testid={name === 'Workspace' ? 'selected-sample' : undefined} data-selected={section === name} aria-current={section === name ? 'page' : undefined} onClick={() => setSection(name)}><Icon size={17}/>{name}</button>)}
      </nav>
      <div className="sidebar-footer"><Laptop size={15}/>This computer<span>{workspace?.name ?? 'Let’s get you set up'}</span></div>
    </aside>
    <main className="companion-main" data-focus-shell tabIndex={-1} aria-busy={!!pending}>
      {client?.simulated && <p role="status" className="notice">Preview · Changes here are not saved.</p>}
      {error && <div role="alert" className="notice error">{error}<Button variant="ghost" onClick={() => void run({ action: 'snapshot' }, 'Trying again')}>Try again</Button></div>}
      {state?.account.error && <p role="alert" className="notice error">{state.account.error}</p>}
      {signingIn && <div role="status" className="notice">Finish signing in through your browser.<Button variant="ghost" disabled={!!pending} onClick={() => void run({ action: 'cancel-sign-in' }, 'Canceling sign-in')}>Cancel sign-in</Button></div>}
      {pending && <p role="status" className="notice">{pending}…</p>}
      {!state && !error && <p role="status">Opening HQ…</p>}
      {section === 'Workspace' && state?.setup && !state.setup.complete ? <section className="welcome" aria-label="HQ setup">
        <HqMark className="welcome-mark"/><h1>{setupRunning ? 'Getting HQ ready' : 'Let’s finish setting up'}</h1>
        <p className="lead">We’ll prepare your workspace and the software it needs. This can take a few minutes.</p>
        <ol className="setup-steps setup-progress">{state.setup.steps.map((step, index) => <li key={step.id}><span className="step-symbol">{step.status === 'ready' ? <Check size={16}/> : index + 1}</span><div><h2>{step.label}</h2><p>{step.status === 'ready' ? 'Ready' : step.status === 'working' ? 'In progress…' : step.status === 'error' ? 'Needs another try' : 'Up next'}</p></div></li>)}</ol>
        {state.setup.error && <p className="notice error" role="alert">{state.setup.error}</p>}
        <div className="welcome-actions">{setupRunning ? <Button variant="outline" disabled={!!pending} onClick={() => void run({ action: 'cancel-setup' }, 'Stopping setup')}>Cancel setup</Button> : <><Button disabled={!!pending} onClick={() => void run({ action: 'resume-setup' }, 'Continuing setup')}>Continue setup<ArrowRight size={16}/></Button><Button variant="ghost" disabled={!!pending} onClick={() => void run({ action: 'reset-setup' }, 'Choosing a different folder')}>Choose another folder</Button></>}</div>
      </section> : section === 'Workspace' && !workspace ? <section className="welcome">
        <HqMark className="welcome-mark"/>
        <h1>Your work, right here.</h1>
        <p className="lead">Set up HQ on this computer and bring your files and team together.</p>
        <div className="welcome-actions"><Button disabled={!enabled} onClick={() => void run({ action: 'create-workspace' }, 'Preparing your workspace')}>Set up HQ<ArrowRight size={16}/></Button><Button variant="ghost" disabled={!enabled} onClick={attach}>I already have an HQ folder</Button></div>
        <ol className="setup-steps">
          <li><span className="step-symbol">1</span><div><h2>Make yourself at home</h2><p>Choose where your work lives on this computer.</p></div></li>
          <li><span className="step-symbol">2</span><div><h2>Connect your account</h2><p>Sign in to find your team and shared work.</p></div></li>
          <li><span className="step-symbol">3</span><div><h2>Pick up where you left off</h2><p>Keep your files up to date across your devices.</p></div></li>
        </ol>
      </section> : section === 'Workspace' && <>
        <header className="page-heading"><h1>Your workspace</h1><p className="lead">A home for your work on this computer.</p></header>
        <section className="content-section"><div className="section-heading"><h2>Folders</h2><Button variant="ghost" disabled={!enabled} onClick={attach}><Plus size={15}/>Add a folder</Button></div>
          <ul className="workspace-list">{state?.workspaces.map((item) => <li key={item.id} data-selected={item.id === state.activeWorkspaceId}><button className="workspace-choice" aria-pressed={item.id === state.activeWorkspaceId} disabled={!enabled} onClick={() => void run({ action: 'select-workspace', workspaceId: item.id }, 'Switching workspace')}><FolderOpen size={22}/><span><span>{item.name}</span><span className="muted workspace-path">{item.root}</span></span>{item.id === state.activeWorkspaceId && <Check size={16}/>}</button><Button variant="ghost" size="icon" aria-label={`Remove ${item.name} from app`} disabled={!enabled} onClick={() => setRemoveId(item.id)}><Trash2 size={15}/></Button></li>)}</ul>
          <div className="welcome-actions"><Button disabled={!enabled} onClick={() => void run({ action: 'open-folder', workspaceId: workspace!.id }, 'Opening your files')}><FolderOpen size={16}/>Open your files</Button></div>
        </section>
        <section className="account-row"><UserRound size={23}/><div><h2>{connected ? state?.account.label ?? 'Your account' : 'Connect your account'}</h2><p>{connected ? 'You’re signed in to HQ.' : 'Sign in to bring your shared work to this computer.'}</p></div><Button variant="outline" disabled={!enabled} onClick={() => void run({ action: connected ? 'sign-out' : 'sign-in' }, connected ? 'Signing out' : 'Opening sign-in')}>{connected ? 'Sign out' : 'Sign in'}{!connected && <ArrowUpRight size={15}/>}</Button></section>
      </>}
      {section === 'Sync' && <>
        <header className="page-heading"><h1>Sync</h1><p className="lead">Your latest work, wherever you need it.</p></header>
        <section className="status-view"><div className="status-orb"><Cloud size={30} strokeWidth={1.5}/></div><h2>{!workspace ? 'Choose a workspace to get started' : !connected ? 'Bring your work together' : state?.sync.message}</h2><p className="lead">{!workspace ? 'Set up HQ or choose your existing folder first.' : !connected ? 'Sign in to keep your files up to date across your devices.' : 'Your files stay on this computer, even when you’re offline.'}</p>
          {workspace && connected && <div className="sync-choice">
            {state?.syncScopes?.length ? <><label htmlFor="sync-workspace">Keep these files on this computer</label><select id="sync-workspace" className="hq-select" value={state.selectedSyncScope ?? ''} disabled={!enabled} onChange={event => void run({ action: 'select-sync-scope', scopeId: event.target.value }, 'Choosing your shared work')}><option value="" disabled>Choose your work</option>{state.syncScopes.map(scope => <option key={scope.id} value={scope.id}>{scope.label}</option>)}</select></> : <Button variant="outline" disabled={!enabled} onClick={() => void run({ action: 'load-sync-scopes' }, 'Finding your shared work')}>Choose your work</Button>}
          </div>}
          {workspace && connected && (state?.sync.phase === 'conflict' || (state?.sync.conflicts ?? 0) > 0) && (
            <ConflictList
              paths={state?.sync.conflictPaths ?? []}
              disabled={!enabled}
              onResolve={(choice: ConflictChoice) => void run({ action: 'resolve-conflicts', choice }, choice === 'abort' ? 'Pausing sync' : 'Applying your choice')}
            />
          )}
          <div className="welcome-actions">{!workspace ? <Button onClick={() => setSection('Workspace')}>Go to workspace<ArrowRight size={16}/></Button> : !connected || state?.sync.phase === 'not-connected' ? <Button disabled={!enabled} onClick={() => void run({ action: 'sign-in' }, 'Opening sign-in')}>Sign in<ArrowUpRight size={15}/></Button> : state?.sync.phase === 'conflict' ? null : <Button disabled={!enabled || !state?.selectedSyncScope} onClick={() => void run({ action: ['syncing', 'idle', 'offline'].includes(state?.sync.phase ?? '') ? 'pause-sync' : 'resume-sync' }, 'Updating sync')}>{['syncing', 'idle', 'offline'].includes(state?.sync.phase ?? '') ? 'Pause sync' : state?.sync.phase === 'paused' ? 'Start syncing' : 'Try sync again'}</Button>}</div>
          <dl className="sync-details"><div><dt>Workspace</dt><dd>{workspace?.name ?? 'Not selected'}</dd></div><div><dt>Last synced</dt><dd>{state?.sync.lastSuccess ? new Date(state.sync.lastSuccess).toLocaleString() : 'Not yet'}</dd></div>{(state?.sync.conflicts ?? 0) > 0 && <div><dt>Needs a choice</dt><dd>{state!.sync.conflicts === 1 ? '1 file' : `${state!.sync.conflicts} files`}</dd></div>}</dl>
        </section>
      </>}
      {section === 'Tools' && <>
        <header className="page-heading"><h1>Tools</h1><p className="lead">A few shortcuts for your workspace.</p></header>
        {!workspace && <p className="notice">Choose your workspace first to use these shortcuts.</p>}
        <section>{[{ title: 'Files', description: 'Browse and organize your work.', action: 'open-folder' as const, icon: FolderOpen }, { title: 'Terminal', description: 'For when you want to work with commands.', action: 'open-terminal' as const, icon: Terminal }].map(({ title, description, action, icon: Icon }) => <div className="tool-row" key={title}><Icon size={22}/><div><h2>{title}</h2><p>{description}</p></div><Button variant="ghost" disabled={!enabled || !workspace} onClick={() => void run({ action, workspaceId: workspace!.id }, `Opening ${title.toLowerCase()}`)}>Open {title.toLowerCase()}<ArrowUpRight size={15}/></Button></div>)}</section>
      </>}
      {section === 'Settings' && state && (
        <SettingsScreen
          state={state}
          health={state.health ?? HEALTH_PREVIEW_FIXTURES.unavailable}
          enabled={enabled}
          connected={connected}
          run={run}
        />
      )}
      <Dialog open={!!removeId} onOpenChange={(open) => { if (!open) setRemoveId(undefined); }}><DialogContent><DialogTitle>Remove this workspace?</DialogTitle><DialogDescription>Your folder and its files will stay on this computer. You can add it again anytime.</DialogDescription><div className="dialog-actions"><Button variant="outline" onClick={() => setRemoveId(undefined)}>Keep workspace</Button><Button onClick={() => { const id = removeId!; setRemoveId(undefined); void run({ action: 'remove-workspace', workspaceId: id }, 'Removing workspace'); }}>Remove from app</Button></div></DialogContent></Dialog>
    </main>
  </div>;
}
