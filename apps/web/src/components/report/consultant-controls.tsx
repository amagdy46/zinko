import { useParams, useRouter } from "@tanstack/react-router"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import {
  type ConsultantPayload,
  type DisclosureLevel,
  OWNER_LABELS,
  type OwnerId,
  type ReportFinding,
} from "@/lib/report-model"
import { saveFindingEdit, saveReportEdit } from "@/server/report-edit"

const SUMMARY_MAX = 2000
const NOTE_MAX = 1000

const PERSONAL_DATA_WARNING =
  "This looks like it contains an email address or phone number. It is saved as typed and printed in the report."

type Saved = { ok: true; value: { personalData: boolean } } | { ok: false; message: string }

/** Runs a save, refreshes the report and says what went wrong; `warning` stays after a save that worked. */
function useSave(onSaved: () => void) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const run = async (action: () => Promise<Saved>) => {
    setPending(true)
    setError(null)
    const result = await action()
    setPending(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    await router.invalidate()
    if (result.value.personalData) setWarning(PERSONAL_DATA_WARNING)
    else onSaved()
  }
  return { pending, error, warning, run, clear: () => setWarning(null) }
}

function Feedback({ error, warning }: { error: string | null; warning: string | null }) {
  return (
    <>
      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {warning === null ? null : (
        <p role="status" className="text-sm text-muted-foreground">
          {warning}
        </p>
      )}
    </>
  )
}

/** "Edit summary": the consultant's own text replaces the generated headlines' lead. */
export function EditSummary({ summary }: { summary: string | null }) {
  const { auditId } = useParams({ from: "/app/audits/$auditId/report" })
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(summary ?? "")
  const save = useSave(() => setOpen(false))
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setText(summary ?? "")
          save.clear()
        }
      }}
    >
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="print:hidden" data-testid="edit-summary">
          Edit summary
        </Button>
      </SheetTrigger>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Edit summary</SheetTitle>
          <SheetDescription>
            Your text is shown as "Summary by" your agency, above the headlines Zinko generates from
            the findings. Clear it to go back to the generated summary alone.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-2 px-4">
          <Label htmlFor="report-summary">Summary</Label>
          <Textarea
            id="report-summary"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={SUMMARY_MAX}
            rows={10}
          />
          <p className="text-xs text-muted-foreground">
            {text.length} of {SUMMARY_MAX} characters
          </p>
          <Feedback error={save.error} warning={save.warning} />
        </div>
        <SheetFooter>
          <Button
            disabled={save.pending}
            onClick={() =>
              void save.run(() => saveReportEdit({ data: { auditId, summary: text } }))
            }
          >
            Save summary
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function NoteDialog({ auditId, finding }: { auditId: string; finding: ReportFinding }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(finding.note ?? "")
  const save = useSave(() => setOpen(false))
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setText(finding.note ?? "")
          save.clear()
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {finding.note === null ? "Add note" : "Edit note"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Note on this finding</DialogTitle>
          <DialogDescription>
            Printed under the finding in the report. Leave it empty to remove the note.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-label="Note"
          maxLength={NOTE_MAX}
          rows={5}
        />
        <Feedback error={save.error} warning={save.warning} />
        <DialogFooter>
          <Button
            disabled={save.pending}
            onClick={() =>
              void save.run(() =>
                saveFindingEdit({ data: { auditId, ruleId: finding.ruleId, note: text } }),
              )
            }
          >
            Save note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const RULE_DEFAULT = "rule"

function OwnerDialog({ auditId, finding }: { auditId: string; finding: ReportFinding }) {
  const [open, setOpen] = useState(false)
  const current = finding.ownerSource === "author" ? (finding.owner ?? RULE_DEFAULT) : RULE_DEFAULT
  const [value, setValue] = useState<string>(current)
  const save = useSave(() => setOpen(false))
  const owners: OwnerId[] = ["consent-platform", "tag-manager", "developer"]
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setValue(current)
          save.clear()
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Change owner
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Who fixes this?</DialogTitle>
          <DialogDescription>
            The action plan groups findings by owner. The rule suggests one; you can override it for
            this report.
          </DialogDescription>
        </DialogHeader>
        <RadioGroup value={value} onValueChange={setValue} aria-label="Owner">
          <div className="flex items-center gap-2">
            <RadioGroupItem value={RULE_DEFAULT} id={`owner-${finding.ruleId}-rule`} />
            <Label htmlFor={`owner-${finding.ruleId}-rule`}>The rule's suggestion</Label>
          </div>
          {owners.map((owner) => (
            <div key={owner} className="flex items-center gap-2">
              <RadioGroupItem value={owner} id={`owner-${finding.ruleId}-${owner}`} />
              <Label htmlFor={`owner-${finding.ruleId}-${owner}`}>{OWNER_LABELS[owner]}</Label>
            </div>
          ))}
        </RadioGroup>
        <Feedback error={save.error} warning={save.warning} />
        <DialogFooter>
          <Button
            disabled={save.pending}
            onClick={() =>
              void save.run(() =>
                saveFindingEdit({
                  data: {
                    auditId,
                    ruleId: finding.ruleId,
                    owner: owners.find((owner) => owner === value) ?? null,
                  },
                }),
              )
            }
          >
            Save owner
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Note, owner and "leave out of the detail" for one finding; shown in the consultant's view only. */
export function FindingActions({ finding, hidden }: { finding: ReportFinding; hidden: boolean }) {
  const { auditId } = useParams({ from: "/app/audits/$auditId/report" })
  const save = useSave(() => undefined)
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden" data-testid="finding-actions">
      <NoteDialog auditId={auditId} finding={finding} />
      <OwnerDialog auditId={auditId} finding={finding} />
      <Button
        variant="outline"
        size="sm"
        disabled={save.pending}
        onClick={() =>
          void save.run(() =>
            saveFindingEdit({ data: { auditId, ruleId: finding.ruleId, hidden: !hidden } }),
          )
        }
      >
        {hidden ? "Show in the detail" : "Leave out of the detail"}
      </Button>
      <Feedback error={save.error} warning={null} />
    </div>
  )
}

/** The page-label choice: Standard prints aliases; Detailed prints the strings listed here. */
export function DisclosureDialog({
  auditId,
  detail,
  disclosure,
  open,
  onOpenChange: setOpen,
  menuOpener,
}: {
  auditId: string
  detail: DisclosureLevel
  disclosure: ConsultantPayload["disclosure"]
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The "More" button that opens this from a menu below `sm`, where the trigger is hidden. */
  menuOpener: React.RefObject<HTMLElement | null>
}) {
  const [value, setValue] = useState<DisclosureLevel>(detail)
  const save = useSave(() => setOpen(false))
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setValue(detail)
          save.clear()
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="disclosure" className="max-sm:hidden">
          Page labels: {detail === "standard" ? "Page 1, Page 2" : "paths and ad-platform IDs"}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto"
        onCloseAutoFocus={(event) => {
          if (window.matchMedia("(min-width: 40rem)").matches) return
          event.preventDefault()
          menuOpener.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>How pages are named in this report</DialogTitle>
          <DialogDescription>
            A page path can hold a name or a token, and no check can tell. Read the list below
            before you switch it on.
          </DialogDescription>
        </DialogHeader>
        <RadioGroup
          value={value}
          onValueChange={(next) => setValue(next === "detailed" ? "detailed" : "standard")}
          aria-label="Page labels"
        >
          <div className="flex items-start gap-2">
            <RadioGroupItem value="standard" id="detail-standard" className="mt-1" />
            <Label htmlFor="detail-standard" className="font-normal">
              Page 1, Page 2: pages are numbered, no address is printed
            </Label>
          </div>
          <div className="flex items-start gap-2">
            <RadioGroupItem value="detailed" id="detail-detailed" className="mt-1" />
            <Label htmlFor="detail-detailed" className="font-normal">
              Print page paths and ad-platform IDs
            </Label>
          </div>
        </RadioGroup>
        <div className="space-y-2 text-sm" data-testid="disclosure-list">
          <p className="font-medium">Exactly what Detailed prints</p>
          <ul className="list-disc space-y-0.5 pl-5 [overflow-wrap:anywhere]">
            {disclosure.pages.map((page) => (
              <li key={page}>{page}</li>
            ))}
            {disclosure.destinations.map((id) => (
              <li key={id}>{id}</li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            Paths are printed as entered, without query or fragment. Ad-platform IDs are the Meta
            and TikTok pixel IDs found in the evidence.
          </p>
        </div>
        <Feedback error={save.error} warning={null} />
        <DialogFooter>
          <Button
            disabled={save.pending || value === detail}
            onClick={() =>
              void save.run(() => saveReportEdit({ data: { auditId, detail: value } }))
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
