import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { JournalEntryRefLink } from "@/components/journal/journal-entry-ref-link";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient, invalidateAccountBalances } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useFormatMoney, useSettings } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { WriteGuard } from "@/components/auth/write-guard";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Users, Plus, Trash2, Calendar, FileText, PlayCircle, AlertCircle, CheckCircle2 } from "lucide-react";
import { ListSkeleton } from "@/components/feedback/list-skeleton";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { HistoryTimeline } from "@/components/audit/history-drawer";
import { PeriodChip } from "@/components/dashboard/period-chip";
import { usePeriod } from "@/contexts/period-context";
import { useLocale } from "@/contexts/locale-context";
import { useT } from "@/i18n/dict";
import type { Employee, Leave, Attendance, PayrollRun, PayrollLineWithEmployee } from "@shared/schema";

// ====================================================================
// Page wrapper
// ====================================================================

export default function HRPage() {
  // The active tab is controlled so deep-links can land on a specific tab.
  // In particular, the "From: Payroll …" badge on the Journal Entries page
  // navigates here with `#pr-<id>`, which must open the Payroll tab so the
  // PayrollTab can scroll/highlight the originating row.
  const [location] = useLocation();
  const t = useT();
  const [tab, setTab] = useState<string>(() => initialTabFromHash());

  useEffect(() => {
    const sync = () => setTab((cur) => mapHashToTab(window.location.hash, cur));
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [location]);

  return (
    <div className="space-y-8" data-testid="hr-page">
      <header className="flex items-end justify-between gap-6 flex-wrap">
        <div className="space-y-2 max-w-2xl">
          <div className="eyebrow text-muted-foreground/80">{t("hr_eyebrow")}</div>
          <h1
            className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground leading-tight"
            data-testid="text-page-title"
          >
            {t("hr_page_title")}
          </h1>
          <p className="text-sm text-muted-foreground max-w-xl">
            {t("hr_page_subtitle")}
          </p>
        </div>
        <PeriodChip />
      </header>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="employees" data-testid="tab-employees">{t("hr_tab_employees")}</TabsTrigger>
          <TabsTrigger value="attendance" data-testid="tab-attendance">{t("hr_tab_attendance")}</TabsTrigger>
          <TabsTrigger value="leaves" data-testid="tab-leaves">{t("hr_tab_leaves")}</TabsTrigger>
          <TabsTrigger value="payroll" data-testid="tab-payroll">{t("hr_tab_payroll")}</TabsTrigger>
        </TabsList>

        <TabsContent value="employees"><EmployeesTab /></TabsContent>
        <TabsContent value="attendance"><AttendanceTab /></TabsContent>
        <TabsContent value="leaves"><LeavesTab /></TabsContent>
        <TabsContent value="payroll"><PayrollTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function initialTabFromHash(): string {
  if (typeof window === "undefined") return "employees";
  return mapHashToTab(window.location.hash, "employees");
}

function mapHashToTab(hash: string, fallback: string): string {
  // Deep-link from the Journal Entries page: `#pr-<id>` opens Payroll tab.
  if (/^#pr-\d+$/.test(hash)) return "payroll";
  return fallback;
}

// ====================================================================
// Employees tab
// ====================================================================

// Built as a factory so the validation messages can be localized through the
// dictionary (t) rather than hardcoded Arabic literals.
function makeEmployeeFormSchema(t: (key: any) => string) {
  return z.object({
    fullName: z.string().min(1, t("hr_val_name_required")),
    jobTitle: z.string().default(""),
    hireDate: z.string().min(1, t("hr_val_hiredate_required")),
    baseSalary: z.coerce.number().nonnegative(),
    allowances: z.coerce.number().nonnegative().default(0),
    isNational: z.boolean().default(true),
    annualLeaveDaysOverride: z.coerce.number().int().nonnegative().optional().nullable(),
    isActive: z.boolean().default(true),
  });
}
type EmployeeFormValues = z.infer<ReturnType<typeof makeEmployeeFormSchema>>;

function EmployeesTab() {
  const { toast } = useToast();
  const t = useT();
  const { dir } = useLocale();
  const fmt = useFormatMoney();
  const [open, setOpen] = useState(false);
  const [detailEmp, setDetailEmp] = useState<Employee | null>(null);
  const { data: employees = [], isLoading } = useQuery<Employee[]>({ queryKey: ["/api/hr/employees"] });

  const employeeFormSchema = makeEmployeeFormSchema(t);
  const form = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeFormSchema),
    defaultValues: { fullName: "", jobTitle: "", hireDate: new Date().toISOString().slice(0, 10), baseSalary: 0, allowances: 0, isNational: true, isActive: true },
  });

  const create = useMutation({
    mutationFn: async (vals: any) => await apiRequest("POST", "/api/hr/employees", vals),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/employees"] });
      setOpen(false);
      form.reset();
      toast({ title: t("hr_toast_done"), description: t("hr_emp_added") });
    },
    onError: (e: any) => toast({ title: t("hr_toast_error"), description: e?.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => await apiRequest("DELETE", `/api/hr/employees/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/hr/employees"] }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>{t("hr_emp_list_title")}</CardTitle>
          <CardDescription>{t("hr_emp_list_desc")}</CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <WriteGuard>
            <Button data-testid="button-add-employee" onClick={() => setOpen(true)}><Plus className="w-4 h-4 ml-2" /> {t("hr_emp_new")}</Button>
          </WriteGuard>
          <DialogContent className="max-w-lg" dir={dir}>
            <DialogHeader>
              <DialogTitle>{t("hr_emp_add_title")}</DialogTitle>
              <DialogDescription>{t("hr_emp_add_desc")}</DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((v) => create.mutate(v))} className="space-y-3">
                <FormField control={form.control} name="fullName" render={({ field }) => (
                  <FormItem><FormLabel>{t("hr_emp_fullname")}</FormLabel><FormControl><Input {...field} data-testid="input-fullname" /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="jobTitle" render={({ field }) => (
                  <FormItem><FormLabel>{t("hr_emp_jobtitle")}</FormLabel><FormControl><Input {...field} data-testid="input-jobtitle" /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="hireDate" render={({ field }) => (
                  <FormItem><FormLabel>{t("hr_emp_hiredate")}</FormLabel><FormControl><Input type="date" {...field} data-testid="input-hiredate" /></FormControl><FormMessage /></FormItem>
                )} />
                <div className="grid grid-cols-2 gap-2">
                  <FormField control={form.control} name="baseSalary" render={({ field }) => (
                    <FormItem><FormLabel>{t("hr_emp_base_salary")}</FormLabel><FormControl><Input type="number" step="any" {...field} data-testid="input-basesalary" /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="allowances" render={({ field }) => (
                    <FormItem><FormLabel>{t("hr_emp_allowances")}</FormLabel><FormControl><Input type="number" step="any" {...field} data-testid="input-allowances" /></FormControl></FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="isNational" render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-md border p-3">
                    <FormLabel>{t("hr_emp_is_national")}</FormLabel>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-national" /></FormControl>
                  </FormItem>
                )} />
                <Button type="submit" className="w-full" disabled={create.isPending} data-testid="button-save-employee">
                  {create.isPending ? t("hr_saving") : t("hr_save")}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <ListSkeleton rows={4} testId="skeleton-employees" />
        ) : employees.length === 0 ? (
          <EmptyState
            icon={<Users className="w-5 h-5" />}
            title={t("hr_emp_empty_title")}
            description={t("hr_emp_empty_desc")}
            testId="empty-employees"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("hr_emp_col_name")}</TableHead>
                <TableHead>{t("hr_emp_col_title")}</TableHead>
                <TableHead>{t("hr_emp_col_hiredate")}</TableHead>
                <TableHead>{t("hr_emp_base_salary")}</TableHead>
                <TableHead>{t("hr_emp_allowances")}</TableHead>
                <TableHead>{t("hr_emp_col_status")}</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.map((e) => (
                <TableRow key={e.id} data-testid={`row-employee-${e.id}`}>
                  <TableCell className="font-medium">
                    <button
                      type="button"
                      onClick={() => setDetailEmp(e)}
                      className="hover:underline text-foreground text-start"
                      data-testid={`link-employee-${e.id}`}
                    >
                      {e.fullName}
                    </button>
                  </TableCell>
                  <TableCell>{e.jobTitle || "—"}</TableCell>
                  <TableCell>{e.hireDate}</TableCell>
                  <TableCell>{fmt(e.baseSalary)}</TableCell>
                  <TableCell>{fmt(e.allowances)}</TableCell>
                  <TableCell>
                    {e.isActive ? <Badge variant="default">{t("hr_emp_active")}</Badge> : <Badge variant="secondary">{t("hr_emp_inactive")}</Badge>}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <WriteGuard>
                        <Button variant="ghost" size="icon" onClick={() => remove.mutate(e.id)} data-testid={`button-delete-employee-${e.id}`}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </WriteGuard>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {detailEmp && (
        <EmployeeDetailDialog
          employee={detailEmp}
          onClose={() => setDetailEmp(null)}
        />
      )}
    </Card>
  );
}

function EmployeeDetailDialog({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const fmt = useFormatMoney();
  const t = useT();
  const { dir } = useLocale();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir={dir} className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-employee-detail">
        <DialogHeader>
          <DialogTitle>{employee.fullName}</DialogTitle>
          <DialogDescription>{t("hr_emp_detail_desc")}</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="summary">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="summary" data-testid="tab-employee-summary">{t("hr_summary")}</TabsTrigger>
            <TabsTrigger value="changes" data-testid="tab-employee-changes">{t("hr_changes")}</TabsTrigger>
          </TabsList>
          <TabsContent value="summary" className="mt-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-muted-foreground">{t("hr_code")}</dt><dd className="font-mono">EMP-{employee.id}</dd></div>
              <div><dt className="text-muted-foreground">{t("hr_emp_jobtitle")}</dt><dd>{employee.jobTitle || "—"}</dd></div>
              <div><dt className="text-muted-foreground">{t("hr_emp_hiredate")}</dt><dd className="font-numeric tabular-nums">{employee.hireDate}</dd></div>
              <div><dt className="text-muted-foreground">{t("hr_emp_col_status")}</dt><dd>{employee.isActive ? <Badge variant="default">{t("hr_emp_active")}</Badge> : <Badge variant="secondary">{t("hr_emp_inactive")}</Badge>}</dd></div>
              <div><dt className="text-muted-foreground">{t("hr_emp_base_salary")}</dt><dd className="font-numeric tabular-nums">{fmt(employee.baseSalary)}</dd></div>
              <div><dt className="text-muted-foreground">{t("hr_emp_allowances")}</dt><dd className="font-numeric tabular-nums">{fmt(employee.allowances)}</dd></div>
              <div><dt className="text-muted-foreground">{t("hr_emp_is_national_short")}</dt><dd>{employee.isNational ? t("hr_yes") : t("hr_no")}</dd></div>
              <div><dt className="text-muted-foreground">{t("hr_emp_annual_leave_override")}</dt><dd>{employee.annualLeaveDaysOverride ?? "—"}</dd></div>
            </dl>
          </TabsContent>
          <TabsContent value="changes" className="mt-4" data-testid="tab-content-employee-changes">
            <div className="rounded-md border border-border max-h-96 overflow-hidden flex flex-col">
              <HistoryTimeline
                entityType="employee"
                entityId={employee.id}
                className="flex-1 min-h-0"
              />
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ====================================================================
// Attendance tab — record absences/overtime
// ====================================================================

function AttendanceTab() {
  const { toast } = useToast();
  const t = useT();
  const { dir } = useLocale();
  const [employeeId, setEmployeeId] = useState<string>("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState("present");
  const [overtime, setOvertime] = useState("0");
  const [detailAtt, setDetailAtt] = useState<Attendance | null>(null);
  const yearMonth = date.slice(0, 7);

  const { data: employees = [] } = useQuery<Employee[]>({ queryKey: ["/api/hr/employees"] });
  const { data: records = [] } = useQuery<Attendance[]>({
    queryKey: ["/api/hr/attendance", { yearMonth, employeeId }],
    queryFn: async () => {
      const params = new URLSearchParams({ yearMonth });
      if (employeeId) params.set("employeeId", employeeId);
      // Send the X-Company-Id workspace header so this read is scoped to the
      // active workspace. The bare fetch here previously omitted it, so for a
      // multi-workspace user the records came from the wrong (fallback)
      // workspace and a newly added employee's attendance never appeared.
      const res = await fetch(`/api/hr/attendance?${params}`, {
        credentials: "include",
        headers: { "X-Company-Id": localStorage.getItem("active_company_id") ?? "" },
      });
      return res.json();
    },
  });

  const save = useMutation({
    mutationFn: async () =>
      await apiRequest("POST", "/api/hr/attendance", {
        employeeId: Number(employeeId),
        date,
        status,
        overtimeHours: Number(overtime),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/attendance"] });
      toast({ title: t("hr_toast_done"), description: t("hr_att_recorded") });
    },
    onError: (e: any) => toast({ title: t("hr_toast_error"), description: e?.message, variant: "destructive" }),
  });

  const empName = (id: number) => employees.find((e) => e.id === id)?.fullName || `#${id}`;
  const statusLabel: Record<string, string> = {
    present: t("hr_att_status_present"),
    absent: t("hr_att_status_absent"),
    leave: t("hr_att_status_leave"),
    holiday: t("hr_att_status_holiday"),
    weekend: t("hr_att_status_weekend"),
  };

  return (
    <div className="grid md:grid-cols-3 gap-4">
      <Card className="md:col-span-1">
        <CardHeader><CardTitle className="flex items-center gap-2"><Calendar className="w-5 h-5" /> {t("hr_att_record_title")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-sm font-medium">{t("hr_att_employee")}</label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger data-testid="select-att-employee"><SelectValue placeholder={t("hr_select_placeholder")} /></SelectTrigger>
              <SelectContent>
                {employees.map((e) => <SelectItem key={e.id} value={String(e.id)}>{e.fullName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">{t("hr_att_date")}</label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-att-date" />
          </div>
          <div>
            <label className="text-sm font-medium">{t("hr_att_status")}</label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger data-testid="select-att-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="present">{t("hr_att_status_present")}</SelectItem>
                <SelectItem value="absent">{t("hr_att_status_absent")}</SelectItem>
                <SelectItem value="leave">{t("hr_att_status_leave")}</SelectItem>
                <SelectItem value="holiday">{t("hr_att_status_holiday_official")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">{t("hr_att_overtime")}</label>
            <Input type="number" step="0.5" value={overtime} onChange={(e) => setOvertime(e.target.value)} data-testid="input-att-overtime" />
          </div>
          <WriteGuard forceDisabled={!employeeId || save.isPending}>
            <Button className="w-full" onClick={() => save.mutate()} data-testid="button-save-attendance">
              {save.isPending ? t("hr_working") : t("hr_save")}
            </Button>
          </WriteGuard>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader><CardTitle>{t("hr_att_records_title")} {yearMonth}</CardTitle></CardHeader>
        <CardContent>
          {records.length === 0 ? (
            <EmptyState
              icon={<Calendar className="w-5 h-5" />}
              title={t("hr_att_empty_title")}
              description={t("hr_att_empty_desc")}
              testId="empty-attendance"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>{t("hr_att_date")}</TableHead><TableHead>{t("hr_att_employee")}</TableHead><TableHead>{t("hr_att_status")}</TableHead><TableHead>{t("hr_att_overtime")}</TableHead><TableHead></TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {records.map((r) => (
                  <TableRow key={r.id} data-testid={`row-att-${r.id}`}>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => setDetailAtt(r)}
                        className="hover:underline text-foreground text-start font-numeric tabular-nums"
                        data-testid={`link-att-${r.id}`}
                      >
                        {r.date}
                      </button>
                    </TableCell>
                    <TableCell>{empName(r.employeeId)}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "absent" ? "destructive" : "default"}>{statusLabel[r.status] || r.status}</Badge>
                    </TableCell>
                    <TableCell>{Number(r.overtimeHours)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {detailAtt && (
        <AttendanceDetailDialog
          attendance={detailAtt}
          employeeName={empName(detailAtt.employeeId)}
          statusLabel={statusLabel[detailAtt.status] || detailAtt.status}
          onClose={() => setDetailAtt(null)}
        />
      )}
    </div>
  );
}

function AttendanceDetailDialog({
  attendance,
  employeeName,
  statusLabel,
  onClose,
}: {
  attendance: Attendance;
  employeeName: string;
  statusLabel: string;
  onClose: () => void;
}) {
  const t = useT();
  const { dir } = useLocale();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir={dir} className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-attendance-detail">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-numeric text-[11px] tabular-nums text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border">
              ATT-{attendance.id}
            </span>
            <span className="truncate">{employeeName} — {attendance.date}</span>
          </DialogTitle>
          <DialogDescription>{t("hr_att_detail_desc")}</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="summary">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="summary" data-testid="tab-attendance-summary">{t("hr_summary")}</TabsTrigger>
            <TabsTrigger value="changes" data-testid="tab-attendance-changes">{t("hr_changes")}</TabsTrigger>
          </TabsList>
          <TabsContent value="summary" className="mt-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-muted-foreground">{t("hr_code")}</dt><dd className="font-mono">ATT-{attendance.id}</dd></div>
              <div><dt className="text-muted-foreground">{t("hr_att_employee")}</dt><dd>{employeeName}</dd></div>
              <div><dt className="text-muted-foreground">{t("hr_att_date")}</dt><dd className="font-numeric tabular-nums">{attendance.date}</dd></div>
              <div>
                <dt className="text-muted-foreground">{t("hr_att_status")}</dt>
                <dd><Badge variant={attendance.status === "absent" ? "destructive" : "default"}>{statusLabel}</Badge></dd>
              </div>
              <div><dt className="text-muted-foreground">{t("hr_att_overtime")}</dt><dd className="font-numeric tabular-nums">{Number(attendance.overtimeHours)}</dd></div>
            </dl>
          </TabsContent>
          <TabsContent value="changes" className="mt-4" data-testid="tab-content-attendance-changes">
            <div className="rounded-md border border-border max-h-96 overflow-hidden flex flex-col">
              <HistoryTimeline
                entityType="attendance"
                entityId={attendance.id}
                entityPeriod={{ start: attendance.date, end: attendance.date }}
                className="flex-1 min-h-0"
              />
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ====================================================================
// Leaves tab
// ====================================================================

function LeavesTab() {
  const { toast } = useToast();
  const t = useT();
  const [employeeId, setEmployeeId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [type, setType] = useState("annual");
  const [detailLeave, setDetailLeave] = useState<Leave | null>(null);

  const { data: employees = [] } = useQuery<Employee[]>({ queryKey: ["/api/hr/employees"] });
  const { data: leaves = [] } = useQuery<Leave[]>({ queryKey: ["/api/hr/leaves"] });

  const days = (() => {
    if (!start || !end) return 0;
    const d = (new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24) + 1;
    return Math.max(0, Math.round(d));
  })();

  const create = useMutation({
    mutationFn: async () => await apiRequest("POST", "/api/hr/leaves", {
      employeeId: Number(employeeId),
      startDate: start,
      endDate: end,
      days,
      type,
      status: "approved",
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/leaves"] });
      setStart(""); setEnd("");
      toast({ title: t("hr_toast_done"), description: t("hr_leave_recorded") });
    },
    onError: (e: any) => toast({ title: t("hr_toast_error"), description: e?.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => await apiRequest("DELETE", `/api/hr/leaves/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/hr/leaves"] }),
  });

  const empName = (id: number) => employees.find((e) => e.id === id)?.fullName || `#${id}`;
  const typeLabel: Record<string, string> = {
    annual: t("hr_leave_type_annual"),
    sick: t("hr_leave_type_sick"),
    unpaid: t("hr_leave_type_unpaid"),
    other: t("hr_leave_type_other"),
  };

  return (
    <div className="grid md:grid-cols-3 gap-4">
      <Card className="md:col-span-1">
        <CardHeader><CardTitle>{t("hr_leave_record_title")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-sm font-medium">{t("hr_att_employee")}</label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger data-testid="select-leave-employee"><SelectValue placeholder={t("hr_select_placeholder")} /></SelectTrigger>
              <SelectContent>{employees.map((e) => <SelectItem key={e.id} value={String(e.id)}>{e.fullName}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">{t("hr_leave_from")}</label>
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} data-testid="input-leave-start" />
          </div>
          <div>
            <label className="text-sm font-medium">{t("hr_leave_to")}</label>
            <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} data-testid="input-leave-end" />
          </div>
          <div>
            <label className="text-sm font-medium">{t("hr_leave_type")}</label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger data-testid="select-leave-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="annual">{t("hr_leave_type_annual")}</SelectItem>
                <SelectItem value="sick">{t("hr_leave_type_sick")}</SelectItem>
                <SelectItem value="unpaid">{t("hr_leave_type_unpaid")}</SelectItem>
                <SelectItem value="other">{t("hr_leave_type_other")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {days > 0 && <p className="text-sm text-muted-foreground">{t("hr_leave_days_count")} <span className="font-bold">{days}</span></p>}
          <WriteGuard forceDisabled={!employeeId || !start || !end || create.isPending}>
            <Button className="w-full" onClick={() => create.mutate()} data-testid="button-save-leave">
              {create.isPending ? t("hr_working") : t("hr_save")}
            </Button>
          </WriteGuard>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader><CardTitle>{t("hr_leave_log_title")}</CardTitle></CardHeader>
        <CardContent>
          {leaves.length === 0 ? (
            <EmptyState
              icon={<Calendar className="w-5 h-5" />}
              title={t("hr_leave_empty_title")}
              description={t("hr_leave_empty_desc")}
              testId="empty-leaves"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>{t("hr_att_employee")}</TableHead><TableHead>{t("hr_leave_from")}</TableHead><TableHead>{t("hr_leave_to")}</TableHead><TableHead>{t("hr_leave_col_days")}</TableHead><TableHead>{t("hr_leave_type")}</TableHead><TableHead></TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {leaves.map((l) => (
                  <TableRow key={l.id} data-testid={`row-leave-${l.id}`}>
                    <TableCell className="font-medium">
                      <button
                        type="button"
                        onClick={() => setDetailLeave(l)}
                        className="hover:underline text-foreground text-start"
                        data-testid={`link-leave-${l.id}`}
                      >
                        {empName(l.employeeId)}
                      </button>
                    </TableCell>
                    <TableCell>{l.startDate}</TableCell>
                    <TableCell>{l.endDate}</TableCell>
                    <TableCell>{l.days}</TableCell>
                    <TableCell><Badge variant="outline">{typeLabel[l.type] || l.type}</Badge></TableCell>
                    <TableCell>
                      <WriteGuard>
                        <Button variant="ghost" size="icon" onClick={() => remove.mutate(l.id)} data-testid={`button-delete-leave-${l.id}`}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </WriteGuard>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {detailLeave && (
        <LeaveDetailDialog
          leave={detailLeave}
          employeeName={empName(detailLeave.employeeId)}
          typeLabel={typeLabel[detailLeave.type] || detailLeave.type}
          onClose={() => setDetailLeave(null)}
        />
      )}
    </div>
  );
}

function LeaveDetailDialog({
  leave,
  employeeName,
  typeLabel,
  onClose,
}: {
  leave: Leave;
  employeeName: string;
  typeLabel: string;
  onClose: () => void;
}) {
  const t = useT();
  const { dir } = useLocale();
  const statusLabel: Record<string, string> = {
    approved: t("hr_leave_status_approved"),
    pending: t("hr_leave_status_pending"),
    rejected: t("hr_leave_status_rejected"),
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir={dir} className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-leave-detail">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-numeric text-[11px] tabular-nums text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border">
              LV-{leave.id}
            </span>
            <span className="truncate">{employeeName} — {typeLabel}</span>
          </DialogTitle>
          <DialogDescription>{t("hr_leave_detail_desc")}</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="summary">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="summary" data-testid="tab-leave-summary">{t("hr_summary")}</TabsTrigger>
            <TabsTrigger value="changes" data-testid="tab-leave-changes">{t("hr_changes")}</TabsTrigger>
          </TabsList>
          <TabsContent value="summary" className="mt-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-muted-foreground">{t("hr_code")}</dt><dd className="font-mono">LV-{leave.id}</dd></div>
              <div><dt className="text-muted-foreground">{t("hr_att_employee")}</dt><dd>{employeeName}</dd></div>
              <div><dt className="text-muted-foreground">{t("hr_leave_type")}</dt><dd><Badge variant="outline">{typeLabel}</Badge></dd></div>
              <div>
                <dt className="text-muted-foreground">{t("hr_emp_col_status")}</dt>
                <dd>
                  <Badge variant={leave.status === "rejected" ? "destructive" : leave.status === "pending" ? "secondary" : "default"}>
                    {statusLabel[leave.status] || leave.status}
                  </Badge>
                </dd>
              </div>
              <div><dt className="text-muted-foreground">{t("hr_leave_from")}</dt><dd className="font-numeric tabular-nums">{leave.startDate}</dd></div>
              <div><dt className="text-muted-foreground">{t("hr_leave_to")}</dt><dd className="font-numeric tabular-nums">{leave.endDate}</dd></div>
              <div><dt className="text-muted-foreground">{t("hr_leave_days")}</dt><dd className="font-numeric tabular-nums">{leave.days}</dd></div>
              {leave.notes && (
                <div className="col-span-2"><dt className="text-muted-foreground">{t("hr_leave_notes")}</dt><dd>{leave.notes}</dd></div>
              )}
            </dl>
          </TabsContent>
          <TabsContent value="changes" className="mt-4" data-testid="tab-content-leave-changes">
            <div className="rounded-md border border-border max-h-96 overflow-hidden flex flex-col">
              <HistoryTimeline
                entityType="leave"
                entityId={leave.id}
                entityPeriod={{ start: leave.startDate, end: leave.endDate }}
                className="flex-1 min-h-0"
              />
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ====================================================================
// Payroll Run tab
// ====================================================================

function DeltaLine({ d, testId }: { d: { text: string; positive: boolean }; testId: string }) {
  const t = useT();
  return (
    <p
      className={`text-xs mt-1 tabular-nums ${d.positive ? "text-green-600 dark:text-green-400" : "text-destructive"}`}
      data-testid={testId}
    >
      {d.text} {t("hr_pay_delta_vs_prev")}
    </p>
  );
}

interface PreviewLine {
  employeeId: number; fullName: string; absentDays: number; baseSalary: number;
  allowances: number; overtime: number; absenceDeduction: number; socialInsuranceEmployee: number;
  socialInsuranceEmployer: number; endOfServiceAccrual: number; leaveAccrual: number; gross: number; netPay: number;
}

function PayrollTab() {
  const { toast } = useToast();
  const t = useT();
  const { dir } = useLocale();
  const fmt = useFormatMoney();
  const settings = useSettings();
  const { period, compareToPrevious, previousRange } = usePeriod();
  // The payroll engine works per (year, month). Derive both from the period's
  // end date so the page-level period chip drives which run is previewed.
  const year = period.end.getFullYear();
  const month = period.end.getMonth() + 1;
  const prevYear = previousRange.end.getFullYear();
  const prevMonth = previousRange.end.getMonth() + 1;
  const [detailRun, setDetailRun] = useState<PayrollRun | null>(null);
  // Deep-link support: when a JE-source-link badge points here with `#pr-<id>`
  // we scroll the matching row into view and pulse a highlight ring so the
  // user can spot it among many runs.
  const [highlightRunId, setHighlightRunId] = useState<number | null>(null);
  // When the server refuses a payroll-run delete with HTTP 409 (because the
  // auto-posted journal entry is referenced by another GL-impact module —
  // depreciation, impairment, document inbox, …), we show its `message`
  // verbatim inside a modal alert. A toast would auto-dismiss before the
  // user could read which module is holding the JE.
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery<{ year: number; month: number; lines: PreviewLine[] }>({
    queryKey: ["/api/hr/payroll/preview", { year, month }],
    queryFn: async () => {
      // Send the X-Company-Id workspace header so the preview is computed for
      // the active workspace. Without it a multi-workspace user saw a payroll
      // preview for the wrong (fallback) workspace — so a newly added employee
      // never appeared on the salary statement.
      const res = await fetch(`/api/hr/payroll/preview?year=${year}&month=${month}`, {
        credentials: "include",
        headers: { "X-Company-Id": localStorage.getItem("active_company_id") ?? "" },
      });
      if (!res.ok) throw new Error(t("hr_pay_load_failed"));
      return res.json();
    },
  });

  const { data: prevData } = useQuery<{ year: number; month: number; lines: PreviewLine[] }>({
    queryKey: ["/api/hr/payroll/preview", { year: prevYear, month: prevMonth }],
    queryFn: async () => {
      const res = await fetch(`/api/hr/payroll/preview?year=${prevYear}&month=${prevMonth}`, {
        credentials: "include",
        headers: { "X-Company-Id": localStorage.getItem("active_company_id") ?? "" },
      });
      if (!res.ok) throw new Error(t("hr_pay_load_failed"));
      return res.json();
    },
    enabled: compareToPrevious,
  });

  const { data: pastRuns = [] } = useQuery<PayrollRun[]>({
    queryKey: ["/api/hr/payroll/runs"],
  });

  // Read `#pr-<id>` from the URL and, once the row is rendered, scroll to it
  // and pulse a highlight ring for ~2.4s. Re-runs whenever the hash changes
  // (so jumping between two badges in the same session "rings" again).
  useEffect(() => {
    const apply = () => {
      const m = window.location.hash.match(/^#pr-(\d+)$/);
      if (!m) return;
      const id = Number(m[1]);
      if (!pastRuns.some((r) => r.id === id)) return;
      // Defer one frame so the row exists in the DOM after a tab switch.
      requestAnimationFrame(() => {
        const el = document.getElementById(`pr-${id}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          setHighlightRunId(id);
          window.setTimeout(() => setHighlightRunId(null), 2400);
        }
      });
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [pastRuns]);

  const run = useMutation({
    mutationFn: async () => await apiRequest("POST", "/api/hr/payroll/run", { year, month }),
    onSuccess: () => {
      toast({ title: t("hr_pay_run_done_title"), description: t("hr_pay_run_done") });
      queryClient.invalidateQueries({ queryKey: ["/api/journal-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/insights"] });
      queryClient.invalidateQueries({ queryKey: ["/api/hr/payroll/runs"] });
      invalidateAccountBalances();
    },
    onError: (e: any) => toast({ title: t("hr_toast_error"), description: e?.message, variant: "destructive" }),
  });

  const removeRun = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/hr/payroll/runs/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/payroll/runs"] });
      // Deleting a payroll run reverses its journal entry, so the COA
      // trailing balances must be invalidated alongside the JE list.
      queryClient.invalidateQueries({ queryKey: ["/api/journal-entries"] });
      invalidateAccountBalances();
      toast({ title: t("hr_toast_done"), description: t("hr_pay_deleted") });
    },
    onError: (e: any) => {
      if (e?.status === 409) {
        // Park the conflict reason in state so the modal alert below can
        // render it. Toasts auto-dismiss after a few seconds, and this
        // message tells the user *which* downstream module is holding the
        // journal entry — they often need long enough to read it, switch
        // tabs, and copy the reference out.
        const fallback = t("hr_pay_delete_conflict_fallback");
        const serverMsg = typeof e?.body?.message === "string" && e.body.message.trim().length > 0
          ? e.body.message
          : fallback;
        setConflictMessage(serverMsg);
        return;
      }
      toast({ title: t("hr_toast_error"), description: e?.message, variant: "destructive" });
    },
  });

  const lines = data?.lines || [];
  const sumTotals = (rows: PreviewLine[]) => rows.reduce(
    (acc, l) => ({
      gross: acc.gross + l.gross,
      net: acc.net + l.netPay,
      siEmp: acc.siEmp + l.socialInsuranceEmployee,
      siEr: acc.siEr + l.socialInsuranceEmployer,
      eos: acc.eos + l.endOfServiceAccrual,
      leave: acc.leave + l.leaveAccrual,
    }),
    { gross: 0, net: 0, siEmp: 0, siEr: 0, eos: 0, leave: 0 },
  );
  const totals = sumTotals(lines);
  const prevTotals = compareToPrevious && prevData ? sumTotals(prevData.lines) : null;
  // Localized month names (index 0 = January) driven by the active locale.
  const monthsAr = [
    t("hr_month_1"), t("hr_month_2"), t("hr_month_3"), t("hr_month_4"),
    t("hr_month_5"), t("hr_month_6"), t("hr_month_7"), t("hr_month_8"),
    t("hr_month_9"), t("hr_month_10"), t("hr_month_11"), t("hr_month_12"),
  ];
  const fmtDelta = (cur: number, prev: number) => {
    const diff = cur - prev;
    const sign = diff >= 0 ? "+" : "−";
    return { text: `${sign}${fmt(Math.abs(diff))}`, positive: diff >= 0 };
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5" /> {t("hr_pay_month_title")}</CardTitle>
          <CardDescription>
            {t("hr_pay_month_desc")}
            <br />{t("hr_pay_country")} <span className="font-bold text-primary">{settings.countryCode}</span> — {t("hr_pay_currency")} <span className="font-bold">{settings.currencySymbol}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div className="text-sm text-muted-foreground" data-testid="text-payroll-period">
              {t("hr_pay_period_shown")} <span className="font-semibold text-foreground">{monthsAr[month - 1]} {year}</span>
              <span className="text-xs block mt-0.5">{t("hr_pay_period_hint")}</span>
            </div>
            <div className="flex-1" />
            <WriteGuard forceDisabled={lines.length === 0 || run.isPending}>
              <Button
                size="lg"
                onClick={() => run.mutate()}
                data-testid="button-run-payroll"
              >
                <PlayCircle className="w-5 h-5 ml-2" />
                {run.isPending ? t("hr_pay_running") : t("hr_pay_run_button")}
              </Button>
            </WriteGuard>
          </div>

          {isLoading ? (
            <ListSkeleton rows={5} testId="skeleton-payroll" />
          ) : error ? (
            <ErrorState
              title={t("hr_pay_error_title")}
              cause={t("hr_pay_error_cause")}
              onRetry={() => refetch()}
              testId="error-payroll"
            />
          ) : lines.length === 0 ? (
            <EmptyState
              icon={<Users className="w-5 h-5" />}
              title={t("hr_pay_empty_title")}
              description={t("hr_pay_empty_desc")}
              testId="empty-payroll"
            />
          ) : (
            <>
              <div className="overflow-x-auto table-sticky-first">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("hr_att_employee")}</TableHead>
                      <TableHead>{t("hr_pay_col_base")}</TableHead>
                      <TableHead>{t("hr_pay_col_allowances")}</TableHead>
                      <TableHead>{t("hr_pay_col_overtime")}</TableHead>
                      <TableHead>{t("hr_pay_col_absence")}</TableHead>
                      <TableHead>{t("hr_pay_col_si_employee")}</TableHead>
                      <TableHead>{t("hr_pay_col_gross")}</TableHead>
                      <TableHead className="font-bold">{t("hr_pay_col_net")}</TableHead>
                      <TableHead>{t("hr_pay_col_eos")}</TableHead>
                      <TableHead>{t("hr_pay_col_leave")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((l) => (
                      <TableRow key={l.employeeId} data-testid={`row-payroll-${l.employeeId}`}>
                        <TableCell className="font-medium">{l.fullName}</TableCell>
                        <TableCell>{fmt(l.baseSalary)}</TableCell>
                        <TableCell>{fmt(l.allowances)}</TableCell>
                        <TableCell>{fmt(l.overtime)}</TableCell>
                        <TableCell className="text-destructive">-{fmt(l.absenceDeduction)}</TableCell>
                        <TableCell className="text-destructive">-{fmt(l.socialInsuranceEmployee)}</TableCell>
                        <TableCell>{fmt(l.gross)}</TableCell>
                        <TableCell className="font-bold text-primary" data-testid={`text-net-${l.employeeId}`}>{fmt(l.netPay)}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{fmt(l.endOfServiceAccrual)}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{fmt(l.leaveAccrual)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
                <Card className="bg-primary/5"><CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">{t("hr_pay_total_gross")}</p>
                  <p className="text-xl font-bold" data-testid="text-total-gross">{fmt(totals.gross)}</p>
                  {prevTotals && <DeltaLine d={fmtDelta(totals.gross, prevTotals.gross)} testId="text-delta-gross" />}
                </CardContent></Card>
                <Card className="bg-primary/10"><CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">{t("hr_pay_total_net")}</p>
                  <p className="text-xl font-bold text-primary" data-testid="text-total-net">{fmt(totals.net)}</p>
                  {prevTotals && <DeltaLine d={fmtDelta(totals.net, prevTotals.net)} testId="text-delta-net" />}
                </CardContent></Card>
                <Card><CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">{t("hr_pay_total_eos")}</p>
                  <p className="text-lg font-semibold" data-testid="text-total-eos">{fmt(totals.eos)}</p>
                  {prevTotals && <DeltaLine d={fmtDelta(totals.eos, prevTotals.eos)} testId="text-delta-eos" />}
                </CardContent></Card>
                <Card><CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">{t("hr_pay_total_leave")}</p>
                  <p className="text-lg font-semibold" data-testid="text-total-leave">{fmt(totals.leave)}</p>
                  {prevTotals && <DeltaLine d={fmtDelta(totals.leave, prevTotals.leave)} testId="text-delta-leave" />}
                </CardContent></Card>
              </div>

              <div className="mt-4 p-3 bg-muted/30 rounded-md text-xs text-muted-foreground flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 text-primary shrink-0" />
                <p>
                  {t("hr_pay_auto_entry")}
                  <span className="block mt-1"><strong>{t("hr_pay_debit")}</strong> {t("hr_pay_debit_salaries")} ({fmt(totals.gross + totals.leave - lines.reduce((s, l) => s + l.absenceDeduction, 0))}) + {t("hr_pay_debit_si_employer")} ({fmt(totals.siEr)}) + {t("hr_pay_debit_eos")} ({fmt(totals.eos)})</span>
                  <span className="block"><strong>{t("hr_pay_credit")}</strong> {t("hr_pay_credit_cash")} ({fmt(totals.net)}) + {t("hr_pay_credit_si_payable")} ({fmt(totals.siEmp + totals.siEr)}) + {t("hr_pay_credit_eos_liab")} ({fmt(totals.eos)}) + {t("hr_pay_credit_leave")} ({fmt(totals.leave)})</span>
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5" /> {t("hr_pay_past_title")}</CardTitle>
          <CardDescription>{t("hr_pay_past_desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {pastRuns.length === 0 ? (
            <EmptyState
              icon={<FileText className="w-5 h-5" />}
              title={t("hr_pay_past_empty_title")}
              description={t("hr_pay_past_empty_desc")}
              testId="empty-payroll-runs"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("hr_pay_col_period")}</TableHead>
                  <TableHead>{t("hr_pay_col_status")}</TableHead>
                  <TableHead>{t("hr_pay_total_gross")}</TableHead>
                  <TableHead>{t("hr_pay_total_net")}</TableHead>
                  <TableHead>{t("hr_pay_col_journal")}</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pastRuns.map((r) => (
                  <TableRow
                    key={r.id}
                    id={`pr-${r.id}`}
                    data-testid={`row-payroll-run-${r.id}`}
                    data-highlighted={highlightRunId === r.id ? "true" : undefined}
                    className={
                      "scroll-mt-24 transition-shadow duration-500 " +
                      (highlightRunId === r.id
                        ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                        : "")
                    }
                  >
                    <TableCell className="font-medium font-numeric tabular-nums">
                      <button
                        type="button"
                        onClick={() => setDetailRun(r)}
                        className="hover:underline text-foreground text-start font-numeric tabular-nums"
                        data-testid={`link-payroll-run-${r.id}`}
                      >
                        {String(r.month).padStart(2, "0")}/{r.year}
                      </button>
                    </TableCell>
                    <TableCell>
                      {r.status === "posted"
                        ? <Badge variant="default">{t("hr_pay_status_posted")}</Badge>
                        : <Badge variant="secondary">{r.status}</Badge>}
                    </TableCell>
                    <TableCell>{fmt(Number(r.totalGross))}</TableCell>
                    <TableCell className="font-bold text-primary">{fmt(Number(r.totalNet))}</TableCell>
                    <TableCell className="text-xs">
                      {r.journalEntryId ? (
                        <JournalEntryRefLink
                          id={r.journalEntryId}
                          className="font-numeric tabular-nums text-primary underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none rounded-sm"
                          data-testid={`link-journal-entry-${r.id}`}
                          title={`${t("hr_pay_open_je_title")} JE-${r.journalEntryId}`}
                        >
                          JE-{r.journalEntryId}
                        </JournalEntryRefLink>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <WriteGuard>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeRun.mutate(r.id)}
                          disabled={removeRun.isPending}
                          data-testid={`button-delete-payroll-run-${r.id}`}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </WriteGuard>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {detailRun && (
        <PayrollRunDetailDialog
          run={detailRun}
          monthLabel={monthsAr[detailRun.month - 1]}
          fmt={fmt}
          onClose={() => setDetailRun(null)}
        />
      )}

      {/*
        Conflict alert: rendered as a modal AlertDialog (not a toast) so the
        server-supplied reason stays on screen until the user dismisses it.
        That gives them time to read which downstream module is holding the
        payroll run's journal entry and to copy any reference out.
      */}
      <AlertDialog
        open={!!conflictMessage}
        onOpenChange={(o) => { if (!o) setConflictMessage(null); }}
      >
        <AlertDialogContent dir={dir} data-testid="dialog-payroll-delete-conflict">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-right">
              <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
              {t("hr_pay_delete_conflict_title")}
            </AlertDialogTitle>
            <AlertDialogDescription
              className="text-sm leading-relaxed text-foreground text-right whitespace-pre-line"
              data-testid="text-payroll-delete-conflict-message"
            >
              {conflictMessage}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => setConflictMessage(null)}
              data-testid="button-payroll-delete-conflict-close"
            >
              {t("hr_pay_delete_conflict_ok")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PayrollRunDetailDialog({
  run,
  monthLabel,
  fmt,
  onClose,
}: {
  run: PayrollRun;
  monthLabel: string;
  fmt: ReturnType<typeof useFormatMoney>;
  onClose: () => void;
}) {
  const t = useT();
  const { dir } = useLocale();
  const gross = Number(run.totalGross);
  const net = Number(run.totalNet);
  const deductions = Math.max(0, gross - net);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir={dir} className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-payroll-run-detail">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-numeric text-[11px] tabular-nums text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border">
              PR-{run.id}
            </span>
            <span className="truncate">{t("hr_pay_run_detail_title")} {monthLabel} {run.year}</span>
          </DialogTitle>
          <DialogDescription>{t("hr_pay_run_detail_desc")}</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="summary">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="summary" data-testid="tab-payroll-run-summary">{t("hr_summary")}</TabsTrigger>
            <TabsTrigger value="lines" data-testid="tab-payroll-run-lines">{t("hr_pay_tab_lines")}</TabsTrigger>
            <TabsTrigger value="changes" data-testid="tab-payroll-run-changes">{t("hr_changes")}</TabsTrigger>
          </TabsList>
          <TabsContent value="summary" className="mt-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-muted-foreground">{t("hr_code")}</dt><dd className="font-mono">PR-{run.id}</dd></div>
              <div>
                <dt className="text-muted-foreground">{t("hr_pay_col_status")}</dt>
                <dd>
                  {run.status === "posted"
                    ? <Badge variant="default">{t("hr_pay_status_posted")}</Badge>
                    : <Badge variant="secondary">{run.status}</Badge>}
                </dd>
              </div>
              <div><dt className="text-muted-foreground">{t("hr_pay_col_period")}</dt><dd className="font-numeric tabular-nums">{monthLabel} {run.year}</dd></div>
              <div>
                <dt className="text-muted-foreground">{t("hr_pay_col_journal")}</dt>
                <dd>
                  {run.journalEntryId ? (
                    <JournalEntryRefLink
                      id={run.journalEntryId}
                      className="font-numeric tabular-nums text-primary underline-offset-4 hover:underline"
                      data-testid={`link-detail-journal-entry-${run.id}`}
                    >
                      JE-{run.journalEntryId}
                    </JournalEntryRefLink>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </dd>
              </div>
              <div><dt className="text-muted-foreground">{t("hr_pay_total_gross")}</dt><dd className="font-numeric tabular-nums" data-testid="text-detail-total-gross">{fmt(gross)}</dd></div>
              <div><dt className="text-muted-foreground">{t("hr_pay_total_net")}</dt><dd className="font-numeric tabular-nums font-bold text-primary" data-testid="text-detail-total-net">{fmt(net)}</dd></div>
              <div><dt className="text-muted-foreground">{t("hr_pay_total_deductions")}</dt><dd className="font-numeric tabular-nums" data-testid="text-detail-total-deductions">{fmt(deductions)}</dd></div>
              {run.createdAt && (
                <div><dt className="text-muted-foreground">{t("hr_pay_created_at")}</dt><dd className="font-numeric tabular-nums">{new Date(run.createdAt).toISOString().slice(0, 10)}</dd></div>
              )}
            </dl>
          </TabsContent>
          <TabsContent value="lines" className="mt-4" data-testid="tab-content-payroll-run-lines">
            <PayrollRunLinesPanel runId={run.id} fmt={fmt} />
          </TabsContent>
          <TabsContent value="changes" className="mt-4" data-testid="tab-content-payroll-run-changes">
            <div className="rounded-md border border-border max-h-96 overflow-hidden flex flex-col">
              <HistoryTimeline
                entityType="payroll_run"
                entityId={run.id}
                entityPeriod={{
                  start: new Date(run.year, run.month - 1, 1),
                  end: new Date(run.year, run.month, 0),
                }}
                className="flex-1 min-h-0"
              />
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// Per-employee breakdown for a posted run. Lives in its own component so the
// query only fires when the user opens the Lines tab (TabsContent does not
// render inactive tabs in shadcn's underlying Radix primitive). Uses the
// numeric strings returned by the API as-is — `useFormatMoney` accepts both
// strings and numbers.
function PayrollRunLinesPanel({
  runId,
  fmt,
}: {
  runId: number;
  fmt: ReturnType<typeof useFormatMoney>;
}) {
  const t = useT();
  const { data, isLoading, error, refetch } = useQuery<PayrollLineWithEmployee[]>({
    queryKey: ["/api/hr/payroll/runs", runId, "lines"],
    queryFn: async () => {
      // Send the X-Company-Id workspace header so these run lines are read
      // from the active workspace (the bare fetch previously omitted it).
      const res = await fetch(`/api/hr/payroll/runs/${runId}/lines`, {
        credentials: "include",
        headers: { "X-Company-Id": localStorage.getItem("active_company_id") ?? "" },
      });
      if (!res.ok) throw new Error(t("hr_pay_lines_load_failed"));
      return res.json();
    },
  });

  if (isLoading) {
    return <ListSkeleton rows={4} testId="loading-payroll-run-lines" />;
  }
  if (error) {
    return (
      <ErrorState
        title={t("hr_pay_lines_error_title")}
        cause={t("hr_pay_lines_error_cause")}
        onRetry={() => refetch()}
        testId="error-payroll-run-lines"
      />
    );
  }
  const lines = data ?? [];
  if (lines.length === 0) {
    return (
      <EmptyState
        icon={<Users className="w-5 h-5" />}
        title={t("hr_pay_lines_empty_title")}
        description={t("hr_pay_lines_empty_desc")}
        testId="empty-payroll-run-lines"
      />
    );
  }
  return (
    <div className="overflow-x-auto table-sticky-first" data-testid="table-payroll-run-lines">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("hr_att_employee")}</TableHead>
            <TableHead>{t("hr_pay_col_base")}</TableHead>
            <TableHead>{t("hr_pay_col_allowances")}</TableHead>
            <TableHead>{t("hr_pay_col_overtime")}</TableHead>
            <TableHead>{t("hr_pay_col_absence")}</TableHead>
            <TableHead>{t("hr_pay_col_si_employee")}</TableHead>
            <TableHead>{t("hr_pay_col_gross")}</TableHead>
            <TableHead className="font-bold">{t("hr_pay_col_net")}</TableHead>
            <TableHead>{t("hr_pay_col_eos")}</TableHead>
            <TableHead>{t("hr_pay_col_leave")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((l) => {
            const base = Number(l.baseSalary);
            const allow = Number(l.allowances);
            const ot = Number(l.overtime);
            const bonus = Number(l.bonuses);
            const absence = Number(l.absenceDeduction);
            const siEmp = Number(l.socialInsuranceEmployee);
            const gross = base + allow + ot + bonus - absence;
            return (
              <TableRow key={l.id} data-testid={`row-payroll-line-${l.employeeId}`}>
                <TableCell className="font-medium" data-testid={`text-line-employee-${l.employeeId}`}>
                  {l.employeeName ?? `#${l.employeeId}`}
                </TableCell>
                <TableCell className="font-numeric tabular-nums">{fmt(base)}</TableCell>
                <TableCell className="font-numeric tabular-nums">{fmt(allow)}</TableCell>
                <TableCell className="font-numeric tabular-nums">{fmt(ot)}</TableCell>
                <TableCell className="font-numeric tabular-nums text-destructive">-{fmt(absence)}</TableCell>
                <TableCell className="font-numeric tabular-nums text-destructive">-{fmt(siEmp)}</TableCell>
                <TableCell className="font-numeric tabular-nums">{fmt(gross)}</TableCell>
                <TableCell
                  className="font-numeric tabular-nums font-bold text-primary"
                  data-testid={`text-line-net-${l.employeeId}`}
                >
                  {fmt(l.netPay)}
                </TableCell>
                <TableCell className="font-numeric tabular-nums text-muted-foreground text-xs">
                  {fmt(l.endOfServiceAccrual)}
                </TableCell>
                <TableCell className="font-numeric tabular-nums text-muted-foreground text-xs">
                  {fmt(l.leaveAccrual)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
