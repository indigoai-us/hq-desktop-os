import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderOpen, RefreshCw, Wrench, Settings, ArrowUpRight, Plus, Monitor, ShieldCheck, Circle, Trash2, Terminal, Code, FileDown } from 'lucide-react';
import { activeWorkspace, type CompanionAction, type CompanionSnapshot } from '../shared/companion';
import { createCompanionClient, type CompanionClient } from './companion-client';
import { getPlatformClient, openReviewedDocsLink } from './platform';
import { ThemeControl } from './theme';
import { Button } from './components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './components/ui/dialog';

const sections = [{ name: 'Setup', icon: FolderOpen }, { name: 'Sync', icon: RefreshCw }, { name: 'Tools', icon: Wrench }, { name: 'Settings', icon: Settings }] as const;
type Section = typeof sections[number]['name'];
export function CompanionApp() {
  const [section, setSection] = useState<Section>('Setup');
  const [client, setClient] = useState<CompanionClient>();
  const [state, setState] = useState<CompanionSnapshot>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState('');
  const busy = useRef(false);
  const [removeId, setRemoveId] = useState<string>();
  const [lastResult, setLastResult] = useState('No native action yet');
  const platform = getPlatformClient();
  const native = platform.availability === 'native';
  useEffect(() => {
    let active = true;
    void createCompanionClient().then(async (adapter) => {
      if (!active) return;
      setClient(adapter);
      try { const snapshot = await adapter.request({ action: 'snapshot' }); if (active) setState(snapshot); }
      catch (cause) { if (active) setError(cause instanceof Error ? cause.message : 'Could not read desktop state.'); }
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not initialize desktop services.'); });
    return () => { active = false; };
  }, []);
  const run = useCallback(async (action: CompanionAction, label: string) => {
    if (!client || busy.current) return;
    busy.current = true; setPending(label); setError('');
    try { setState(await client.request(action)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Desktop operation failed.'); }
    finally { busy.current = false; setPending(''); }
  }, [client]);
  const workspace = state && activeWorkspace(state);
  const enabled = !!state && !pending;
  const checkNative = async () => {
    setLastResult('Check native → pending');
    const result = await platform.getInfo();
    setLastResult(result.ok ? 'Check native → ok' : `Check native → ${result.error.code}: ${result.error.message}`);
  };
  const docs = async () => {
    setLastResult('Open docs → pending');
    const result = await openReviewedDocsLink(platform);
    setLastResult(result.ok ? 'Open docs → ok' : `Open docs → ${result.error.code}: ${result.error.message}`);
  };
  return <div className="companion-shell">
    <aside className="companion-sidebar" aria-label="Desktop navigation">
      <div className="workspace-caption"><Monitor size={16} /><span>{workspace?.name ?? 'No workspace selected'}</span></div>
      <p className="muted environment">{state ? state.platform === 'win32' ? 'Windows · native' : 'Linux · native' : 'Browser preview'}</p>
      <nav aria-label="Companion">
        {sections.map(({ name, icon: Icon }) => <button key={name} className="hq-button hq-nav-item" data-testid={name === 'Setup' ? 'selected-sample' : undefined} data-selected={section === name} aria-current={section === name ? 'page' : undefined} onClick={() => setSection(name)}><Icon size={16}/>{name}</button>)}
      </nav>
      <section className="sidebar-footer" aria-label="Application actions">
        <ThemeControl />
        <button className="text-action" data-testid="open-docs" aria-describedby={native ? undefined : "platform-unavailable-note"} disabled={!native} onClick={() => void docs()}>Open documentation in your browser <ArrowUpRight size={14}/></button>
        <button className="text-action" data-testid="check-native" onClick={() => void checkNative()}>Check native connection</button>
        <p className="muted" data-testid="platform-availability">{native ? 'Native bridge connected' : 'Native bridge unavailable'}</p>
        <p className="muted" role="status" data-testid="platform-last-result">{lastResult}</p>
      </section>
    </aside>
    <main className="companion-main" data-focus-shell tabIndex={-1}>
      <header className="page-heading"><div><p className="eyebrow">{section === 'Setup' ? 'WORKSPACE' : section.toUpperCase()}</p><h1 className="hq-title">{section === 'Setup' ? 'Your desktop companion' : section}</h1></div><span className="build-label">Local test build {state?.version}</span></header>
      {client?.simulated && <p role="status" className="notice">Development preview · Simulated workspace data. Native actions are not performed.</p>}
      {!native && !client?.simulated && <p className="notice" role="status" data-testid="platform-unavailable" id="platform-unavailable-note">Native platform unavailable · Preload bridge missing. Native actions are disabled rather than simulated.</p>}
      {error && <div role="alert" className="notice error">{error}<Button variant="outline" onClick={() => void run({ action: 'snapshot' }, 'Reading desktop state')}>Retry</Button></div>}
      {pending && <p role="status" className="notice">{pending}…</p>}
      {!state && !error && <p role="status">Loading desktop state…</p>}
      {section === 'Setup' && <>
        <p className="lead muted">Keep your HQ workspace close. Open your files and tools from one place.</p>
        <section className="panel"><div className="panel-heading"><h2>Workspaces</h2><Button variant="outline" disabled={!enabled} onClick={() => void run({ action: 'attach-workspace' }, 'Choosing workspace')}><Plus size={15}/>Attach existing HQ</Button></div>
          {!state?.workspaces.length ? <div className="empty-state"><FolderOpen size={28} strokeWidth={1}/><h2>Choose your HQ folder</h2><p className="muted">Attach an existing workspace containing your core and companies folders. Your files stay where they are.</p><p className="muted">Fresh workspace creation will be available after the setup integration is verified.</p></div> : <ul className="workspace-list">{state.workspaces.map((item) => <li key={item.id} data-selected={item.id === state.activeWorkspaceId}><button className="workspace-choice" aria-pressed={item.id === state.activeWorkspaceId} disabled={!enabled} onClick={() => void run({ action: 'select-workspace', workspaceId: item.id }, 'Selecting workspace')}><FolderOpen size={18}/><span><span>{item.name}</span><span className="muted workspace-path">{item.root}</span></span><span className="muted">{item.environment}</span></button><Button variant="ghost" size="icon" aria-label={`Remove ${item.name} from app`} disabled={!enabled} onClick={() => setRemoveId(item.id)}><Trash2 size={15}/></Button></li>)}</ul>}
        </section>
        <section className="panel"><div className="panel-heading"><h2>Account connection</h2><span className="status-label"><Circle size={10}/>Not connected</span></div><p className="muted">Browser sign-in and secure token storage are still being integrated. Sync remains disabled in this build.</p></section>
      </>}
      {section === 'Sync' && <>
        <p className="lead muted">The shared HQ engine will keep your selected workspace in sync.</p>
        <section className="panel"><div className="panel-heading"><h2>{workspace?.name ?? 'No workspace selected'}</h2><span className="status-label">Not connected</span></div><p>{state?.sync.message ?? 'Open the installed app to read sync status.'}</p><dl className="detail-grid"><div><dt>Last successful sync</dt><dd>{state?.sync.lastSuccess ?? 'Not yet synced by this app'}</dd></div><div><dt>Managed processes</dt><dd>None</dd></div><div><dt>Conflict handling</dt><dd>Preserve local and remote versions</dd></div><div><dt>Engine</dt><dd>HQ Cloud {state?.runtime.version ?? '6.16.35'}</dd></div></dl><p className="muted">Existing CLI or tray-app sync continues independently. This app does not take over those processes.</p></section>
      </>}
      {section === 'Tools' && <>
        <p className="lead muted">Open the tools already installed on your computer.</p>
        {!workspace && <p className="notice">Attach and select a workspace in Setup first.</p>}
        <section className="panel tool-list">{[{ title: 'Files', description: 'Open the selected workspace in your file manager.', action: 'open-folder', icon: FolderOpen }, { title: 'Terminal', description: 'Start your default terminal in the workspace folder.', action: 'open-terminal', icon: Terminal }, { title: 'VS Code', description: 'Open the workspace in an installed VS Code.', action: 'open-editor', icon: Code }].map(({ title, description, action, icon: Icon }) => <div className="tool-row" key={title}><Icon size={20}/><div><h2>{title}</h2><p className="muted">{description}</p></div><Button variant="outline" disabled={!enabled || !workspace} onClick={() => void run({ action: action as CompanionAction['action'], workspaceId: workspace!.id }, `Opening ${title}`)}>Open {title}<ArrowUpRight size={14}/></Button></div>)}</section>
      </>}
      {section === 'Settings' && <>
        <p className="lead muted">Local preferences and diagnostics for this installation.</p>
        <section className="panel"><div className="panel-heading"><h2><ShieldCheck size={16}/>Diagnostics</h2><Button variant="outline" disabled={!enabled} onClick={() => void run({ action: 'diagnostics' }, 'Checking desktop services')}><RefreshCw size={14}/>Refresh checks</Button></div><p className="muted">The report below excludes workspace paths, account details, credentials, and environment variables. Nothing is uploaded.</p><ul className="diagnostic-list">{state?.diagnostics.map((check) => <li key={check.name}><span className="status-label" data-state={check.state}>{check.state === 'ok' ? 'Ready' : check.state === 'attention' ? 'Needs attention' : 'Unavailable'}</span><div><h2>{check.name}</h2><p className="muted">{check.detail}</p></div></li>)}</ul><Button variant="outline" disabled={!enabled} onClick={() => void run({ action: 'export-diagnostics' }, 'Exporting diagnostics')}><FileDown size={14}/>Export this report</Button></section>
        <section className="panel"><h2>App behavior</h2><p className="muted">Closing the window quits the app. Background tray sync, automatic startup, and updates are not enabled in this local build.</p><p className="muted">Uninstalling the app leaves your HQ workspace folders intact.</p></section>
      </>}
      <Dialog open={!!removeId} onOpenChange={(open) => { if (!open) setRemoveId(undefined); }}><DialogContent><DialogTitle>Remove workspace from this app?</DialogTitle><DialogDescription>Your HQ folder and all its files will stay on disk. You can attach it again later.</DialogDescription><div className="dialog-actions"><Button variant="outline" onClick={() => setRemoveId(undefined)}>Cancel</Button><Button onClick={() => { const id = removeId!; setRemoveId(undefined); void run({ action: 'remove-workspace', workspaceId: id }, 'Removing workspace from app'); }}>Remove from app</Button></div></DialogContent></Dialog>
    </main>
  </div>;
}
