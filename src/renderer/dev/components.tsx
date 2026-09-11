/**
 * Development-only component gallery.
 * Mounted solely when `import.meta.env.DEV` is true and the path is
 * `/dev/components`. Absent from the production renderer graph — there is no
 * production query-string or hash escape hatch.
 */
import { useId, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ThemeProvider } from '../theme';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';
import { DEV_COMPONENT_GALLERY_PATH, isDevGalleryPath } from './gallery-path';
import '../styles.css';

export { DEV_COMPONENT_GALLERY_PATH, isDevGalleryPath };

function StateSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="hq-gallery-section" aria-labelledby={undefined} data-state-section={title}>
      <h2 className="hq-gallery-heading">{title}</h2>
      <div className="hq-gallery-row">{children}</div>
    </section>
  );
}

function GalleryForm() {
  const nameId = useId();
  const errorId = useId();
  const pendingId = useId();
  const [value, setValue] = useState('not-an-email');
  const [region, setRegion] = useState('us-east');
  const invalid = !value.includes('@');

  return (
    <form
      className="hq-gallery-form"
      onSubmit={(event) => {
        event.preventDefault();
      }}
      noValidate
    >
      <div className="hq-gallery-field">
        <Label htmlFor={nameId}>Work email</Label>
        <Input
          id={nameId}
          name="email"
          value={value}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          data-testid="gallery-email"
          onChange={(event) => setValue(event.target.value)}
        />
        {invalid ? (
          <p
            id={errorId}
            role="alert"
            className="hq-status"
            data-tone="danger"
            data-testid="gallery-email-error"
          >
            Enter an email that includes @. Color is not the only signal — this text names the error.
          </p>
        ) : null}
      </div>

      <div className="hq-gallery-field">
        <Label htmlFor="gallery-region">Region</Label>
        <Select value={region} onValueChange={setRegion}>
          <SelectTrigger id="gallery-region" aria-label="Region" data-testid="gallery-region">
            <SelectValue placeholder="Choose a region" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="us-east">US East</SelectItem>
            <SelectItem value="eu-west">EU West</SelectItem>
            <SelectItem value="ap-south">AP South</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="hq-gallery-field" aria-busy="true" aria-describedby={pendingId}>
        <Label>Sync progress</Label>
        <Progress value={42} aria-label="Workspace sync" data-testid="gallery-progress" />
        <p id={pendingId} className="hq-status" data-tone="info" role="status">
          Pending · 42% complete
        </p>
      </div>
    </form>
  );
}

export function DevComponentGallery() {
  const [dialogMounted, setDialogMounted] = useState(true);

  return (
    <TooltipProvider>
      <main className="hq-page" data-focus-shell tabIndex={-1} data-testid="dev-component-gallery">
        <h1 className="hq-title">Component gallery</h1>
        <p className="hq-body">
          Development-only surface for accessible shadcn primitives. Not included in production
          builds.
        </p>

        <StateSection title="Button states">
          <Button type="button" data-testid="gallery-button-normal">
            Normal
          </Button>
          <Button type="button" disabled data-testid="gallery-button-disabled">
            Disabled
          </Button>
          <Button type="button" aria-busy="true" data-testid="gallery-button-pending">
            Pending
          </Button>
          <Button
            type="button"
            variant="destructive"
            aria-invalid="true"
            data-testid="gallery-button-error"
          >
            Error
          </Button>
        </StateSection>

        <StateSection title="Dialog and select">
          {dialogMounted ? (
            <Dialog>
              <DialogTrigger asChild>
                <Button type="button" data-testid="gallery-dialog-open">
                  Open dialog
                </Button>
              </DialogTrigger>
              <DialogContent
                focusReturnSelector='[data-testid="gallery-dialog-fallback"]'
                aria-describedby="gallery-dialog-desc"
              >
                <DialogHeader>
                  <DialogTitle>Confirm action</DialogTitle>
                  <DialogDescription id="gallery-dialog-desc">
                    Press Escape or Close. Focus restores to the opener when it still exists, or to
                    the fallback control when the opener has unmounted.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    data-testid="gallery-unmount-opener"
                    onClick={() => setDialogMounted(false)}
                  >
                    Unmount opener
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : (
            <p className="hq-status" data-tone="warning" role="status">
              Opener unmounted while dialog was open — use the fallback control below.
            </p>
          )}
          <Button type="button" data-testid="gallery-dialog-fallback" variant="secondary">
            Focus fallback
          </Button>
        </StateSection>

        <StateSection title="Form, errors, progress, tooltip">
          <GalleryForm />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="outline" data-testid="gallery-tooltip-trigger">
                Tooltip target
              </Button>
            </TooltipTrigger>
            <TooltipContent data-testid="gallery-tooltip-content">
              Readable helper text at 200% zoom.
            </TooltipContent>
          </Tooltip>
        </StateSection>
      </main>
    </TooltipProvider>
  );
}

export function mountDevComponentGallery(rootEl: HTMLElement): Root {
  const root = createRoot(rootEl);
  root.render(
    <ThemeProvider>
      <DevComponentGallery />
    </ThemeProvider>,
  );
  return root;
}
