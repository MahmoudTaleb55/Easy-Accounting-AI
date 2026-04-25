import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
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
          <div className="eyebrow text-muted-foreground/80">الموارد والأصول</div>
          <h1
            className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground leading-tight"
            data-testid="text-page-title"
          >
            فريقك ورواتبه — في مكان واحد.
          </h1>
          <p className="text-sm text-muted-foreground max-w-xl">
            الموظفون، الحضور، الإجازات وكشوف الرواتب — مع تسجيل تلقائي للقيود وفق IFRS / IAS 19.
          </p>
        </div>
        <PeriodChip />
      </header>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="employees" data-testid="tab-employees">الموظفون</TabsTrigger>
          <TabsTrigger value="attendance" data-testid="tab-attendance">الحضور</TabsTrigger>
          <TabsTrigger value="leaves" data-testid="tab-leaves">الإجازات</TabsTrigger>
          <TabsTrigger value="payroll" data-testid="tab-payroll">كشف الرواتب</TabsTrigger>
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

const employeeFormSchema = z.object({
  fullName: z.string().min(1, "الاسم مطلوب"),
  jobTitle: z.string().default(""),
  hireDate: z.string().min(1, "تاريخ التعيين مطلوب"),
  baseSalary: z.coerce.number().nonnegative(),
  allowances: z.coerce.number().nonnegative().default(0),
  isNational: z.boolean().default(true),
  annualLeaveDaysOverride: z.coerce.number().int().nonnegative().optional().nullable(),
  isActive: z.boolean().default(true),
});

function EmployeesTab() {
  const { toast } = useToast();
  const fmt = useFormatMoney();
  const [open, setOpen] = useState(false);
  const [detailEmp, setDetailEmp] = useState<Employee | null>(null);
  const { data: employees = [], isLoading } = useQuery<Employee[]>({ queryKey: ["/api/hr/employees"] });

  const form = useForm<z.infer<typeof employeeFormSchema>>({
    resolver: zodResolver(employeeFormSchema),
    defaultValues: { fullName: "", jobTitle: "", hireDate: new Date().toISOString().slice(0, 10), baseSalary: 0, allowances: 0, isNational: true, isActive: true },
  });

  const create = useMutation({
    mutationFn: async (vals: any) => await apiRequest("POST", "/api/hr/employees", vals),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/employees"] });
      setOpen(false);
      form.reset();
      toast({ title: "تم", description: "تمت إضافة الموظف" });
    },
    onError: (e: any) => toast({ title: "خطأ", description: e?.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => await apiRequest("DELETE", `/api/hr/employees/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/hr/employees"] }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>قائمة الموظفين</CardTitle>
          <CardDescription>سجل الموظفين النشطين بالمنشأة</CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <WriteGuard>
            <Button data-testid="button-add-employee" onClick={() => setOpen(true)}><Plus className="w-4 h-4 ml-2" /> موظف جديد</Button>
          </WriteGuard>
          <DialogContent className="max-w-lg" dir="rtl">
            <DialogHeader>
              <DialogTitle>إضافة موظف</DialogTitle>
              <DialogDescription>أدخل بيانات الموظف الأساسية</DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((v) => create.mutate(v))} className="space-y-3">
                <FormField control={form.control} name="fullName" render={({ field }) => (
                  <FormItem><FormLabel>الاسم الكامل</FormLabel><FormControl><Input {...field} data-testid="input-fullname" /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="jobTitle" render={({ field }) => (
                  <FormItem><FormLabel>المسمى الوظيفي</FormLabel><FormControl><Input {...field} data-testid="input-jobtitle" /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="hireDate" render={({ field }) => (
                  <FormItem><FormLabel>تاريخ التعيين</FormLabel><FormControl><Input type="date" {...field} data-testid="input-hiredate" /></FormControl><FormMessage /></FormItem>
                )} />
                <div className="grid grid-cols-2 gap-2">
                  <FormField control={form.control} name="baseSalary" render={({ field }) => (
                    <FormItem><FormLabel>الراتب الأساسي</FormLabel><FormControl><Input type="number" step="any" {...field} data-testid="input-basesalary" /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="allowances" render={({ field }) => (
                    <FormItem><FormLabel>البدلات</FormLabel><FormControl><Input type="number" step="any" {...field} data-testid="input-allowances" /></FormControl></FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="isNational" render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-md border p-3">
                    <FormLabel>مواطن (لتحديد نسبة التأمينات)</FormLabel>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-national" /></FormControl>
                  </FormItem>
                )} />
                <Button type="submit" className="w-full" disabled={create.isPending} data-testid="button-save-employee">
                  {create.isPending ? "جاري الحفظ..." : "حفظ"}
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
            title="لا يوجد موظفون بعد"
            description="أضف أول موظف لتبدأ بتشغيل الرواتب وحساب نهاية الخدمة."
            testId="empty-employees"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الاسم</TableHead>
                <TableHead>المسمى</TableHead>
                <TableHead>تاريخ التعيين</TableHead>
                <TableHead>الراتب الأساسي</TableHead>
                <TableHead>البدلات</TableHead>
                <TableHead>الحالة</TableHead>
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
                    {e.isActive ? <Badge variant="default">نشط</Badge> : <Badge variant="secondary">معطل</Badge>}
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
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-employee-detail">
        <DialogHeader>
          <DialogTitle>{employee.fullName}</DialogTitle>
          <DialogDescription>تفاصيل الموظف وسجل التغييرات.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="summary">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="summary" data-testid="tab-employee-summary">ملخص</TabsTrigger>
            <TabsTrigger value="changes" data-testid="tab-employee-changes">التغييرات</TabsTrigger>
          </TabsList>
          <TabsContent value="summary" className="mt-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-muted-foreground">الكود</dt><dd className="font-mono">EMP-{employee.id}</dd></div>
              <div><dt className="text-muted-foreground">المسمى الوظيفي</dt><dd>{employee.jobTitle || "—"}</dd></div>
              <div><dt className="text-muted-foreground">تاريخ التعيين</dt><dd className="font-numeric tabular-nums">{employee.hireDate}</dd></div>
              <div><dt className="text-muted-foreground">الحالة</dt><dd>{employee.isActive ? <Badge variant="default">نشط</Badge> : <Badge variant="secondary">معطل</Badge>}</dd></div>
              <div><dt className="text-muted-foreground">الراتب الأساسي</dt><dd className="font-numeric tabular-nums">{fmt(employee.baseSalary)}</dd></div>
              <div><dt className="text-muted-foreground">البدلات</dt><dd className="font-numeric tabular-nums">{fmt(employee.allowances)}</dd></div>
              <div><dt className="text-muted-foreground">مواطن</dt><dd>{employee.isNational ? "نعم" : "لا"}</dd></div>
              <div><dt className="text-muted-foreground">رصيد إجازة سنوي مخصص</dt><dd>{employee.annualLeaveDaysOverride ?? "—"}</dd></div>
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
      const res = await fetch(`/api/hr/attendance?${params}`);
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
      toast({ title: "تم", description: "تم تسجيل الحضور" });
    },
    onError: (e: any) => toast({ title: "خطأ", description: e?.message, variant: "destructive" }),
  });

  const empName = (id: number) => employees.find((e) => e.id === id)?.fullName || `#${id}`;
  const statusLabel: Record<string, string> = { present: "حاضر", absent: "غائب", leave: "إجازة", holiday: "عطلة", weekend: "نهاية أسبوع" };

  return (
    <div className="grid md:grid-cols-3 gap-4">
      <Card className="md:col-span-1">
        <CardHeader><CardTitle className="flex items-center gap-2"><Calendar className="w-5 h-5" /> تسجيل حضور</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-sm font-medium">الموظف</label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger data-testid="select-att-employee"><SelectValue placeholder="اختر..." /></SelectTrigger>
              <SelectContent>
                {employees.map((e) => <SelectItem key={e.id} value={String(e.id)}>{e.fullName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">التاريخ</label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-att-date" />
          </div>
          <div>
            <label className="text-sm font-medium">الحالة</label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger data-testid="select-att-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="present">حاضر</SelectItem>
                <SelectItem value="absent">غائب</SelectItem>
                <SelectItem value="leave">إجازة</SelectItem>
                <SelectItem value="holiday">عطلة رسمية</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">ساعات إضافية</label>
            <Input type="number" step="0.5" value={overtime} onChange={(e) => setOvertime(e.target.value)} data-testid="input-att-overtime" />
          </div>
          <WriteGuard forceDisabled={!employeeId || save.isPending}>
            <Button className="w-full" onClick={() => save.mutate()} data-testid="button-save-attendance">
              {save.isPending ? "..." : "حفظ"}
            </Button>
          </WriteGuard>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader><CardTitle>سجلات شهر {yearMonth}</CardTitle></CardHeader>
        <CardContent>
          {records.length === 0 ? (
            <EmptyState
              icon={<Calendar className="w-5 h-5" />}
              title="لا توجد سجلات حضور بعد"
              description="اختر موظفاً وتاريخاً ثم سجّل أول حضور أو غياب لتظهر السجلات هنا."
              testId="empty-attendance"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>التاريخ</TableHead><TableHead>الموظف</TableHead><TableHead>الحالة</TableHead><TableHead>ساعات إضافية</TableHead><TableHead></TableHead></TableRow>
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
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-attendance-detail">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-numeric text-[11px] tabular-nums text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border">
              ATT-{attendance.id}
            </span>
            <span className="truncate">{employeeName} — {attendance.date}</span>
          </DialogTitle>
          <DialogDescription>تفاصيل سجل الحضور وسجل التغييرات.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="summary">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="summary" data-testid="tab-attendance-summary">ملخص</TabsTrigger>
            <TabsTrigger value="changes" data-testid="tab-attendance-changes">التغييرات</TabsTrigger>
          </TabsList>
          <TabsContent value="summary" className="mt-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-muted-foreground">الكود</dt><dd className="font-mono">ATT-{attendance.id}</dd></div>
              <div><dt className="text-muted-foreground">الموظف</dt><dd>{employeeName}</dd></div>
              <div><dt className="text-muted-foreground">التاريخ</dt><dd className="font-numeric tabular-nums">{attendance.date}</dd></div>
              <div>
                <dt className="text-muted-foreground">الحالة</dt>
                <dd><Badge variant={attendance.status === "absent" ? "destructive" : "default"}>{statusLabel}</Badge></dd>
              </div>
              <div><dt className="text-muted-foreground">ساعات إضافية</dt><dd className="font-numeric tabular-nums">{Number(attendance.overtimeHours)}</dd></div>
            </dl>
          </TabsContent>
          <TabsContent value="changes" className="mt-4" data-testid="tab-content-attendance-changes">
            <div className="rounded-md border border-border max-h-96 overflow-hidden flex flex-col">
              <HistoryTimeline
                entityType="attendance"
                entityId={attendance.id}
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
      toast({ title: "تم", description: "تم تسجيل الإجازة" });
    },
    onError: (e: any) => toast({ title: "خطأ", description: e?.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => await apiRequest("DELETE", `/api/hr/leaves/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/hr/leaves"] }),
  });

  const empName = (id: number) => employees.find((e) => e.id === id)?.fullName || `#${id}`;
  const typeLabel: Record<string, string> = { annual: "سنوية", sick: "مرضية", unpaid: "بدون راتب", other: "أخرى" };

  return (
    <div className="grid md:grid-cols-3 gap-4">
      <Card className="md:col-span-1">
        <CardHeader><CardTitle>تسجيل إجازة</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-sm font-medium">الموظف</label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger data-testid="select-leave-employee"><SelectValue placeholder="اختر..." /></SelectTrigger>
              <SelectContent>{employees.map((e) => <SelectItem key={e.id} value={String(e.id)}>{e.fullName}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">من</label>
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} data-testid="input-leave-start" />
          </div>
          <div>
            <label className="text-sm font-medium">إلى</label>
            <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} data-testid="input-leave-end" />
          </div>
          <div>
            <label className="text-sm font-medium">النوع</label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger data-testid="select-leave-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="annual">سنوية</SelectItem>
                <SelectItem value="sick">مرضية</SelectItem>
                <SelectItem value="unpaid">بدون راتب</SelectItem>
                <SelectItem value="other">أخرى</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {days > 0 && <p className="text-sm text-muted-foreground">عدد الأيام: <span className="font-bold">{days}</span></p>}
          <WriteGuard forceDisabled={!employeeId || !start || !end || create.isPending}>
            <Button className="w-full" onClick={() => create.mutate()} data-testid="button-save-leave">
              {create.isPending ? "..." : "حفظ"}
            </Button>
          </WriteGuard>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader><CardTitle>سجل الإجازات</CardTitle></CardHeader>
        <CardContent>
          {leaves.length === 0 ? (
            <EmptyState
              icon={<Calendar className="w-5 h-5" />}
              title="لا توجد إجازات مسجَّلة"
              description="أضف أول طلب إجازة لتظهر مع رصيد المتبقي وتحتسب في كشف الراتب."
              testId="empty-leaves"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>الموظف</TableHead><TableHead>من</TableHead><TableHead>إلى</TableHead><TableHead>الأيام</TableHead><TableHead>النوع</TableHead><TableHead></TableHead></TableRow>
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
  const statusLabel: Record<string, string> = {
    approved: "معتمدة",
    pending: "قيد الانتظار",
    rejected: "مرفوضة",
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-leave-detail">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-numeric text-[11px] tabular-nums text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border">
              LV-{leave.id}
            </span>
            <span className="truncate">{employeeName} — {typeLabel}</span>
          </DialogTitle>
          <DialogDescription>تفاصيل طلب الإجازة وسجل التغييرات.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="summary">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="summary" data-testid="tab-leave-summary">ملخص</TabsTrigger>
            <TabsTrigger value="changes" data-testid="tab-leave-changes">التغييرات</TabsTrigger>
          </TabsList>
          <TabsContent value="summary" className="mt-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-muted-foreground">الكود</dt><dd className="font-mono">LV-{leave.id}</dd></div>
              <div><dt className="text-muted-foreground">الموظف</dt><dd>{employeeName}</dd></div>
              <div><dt className="text-muted-foreground">النوع</dt><dd><Badge variant="outline">{typeLabel}</Badge></dd></div>
              <div>
                <dt className="text-muted-foreground">الحالة</dt>
                <dd>
                  <Badge variant={leave.status === "rejected" ? "destructive" : leave.status === "pending" ? "secondary" : "default"}>
                    {statusLabel[leave.status] || leave.status}
                  </Badge>
                </dd>
              </div>
              <div><dt className="text-muted-foreground">من</dt><dd className="font-numeric tabular-nums">{leave.startDate}</dd></div>
              <div><dt className="text-muted-foreground">إلى</dt><dd className="font-numeric tabular-nums">{leave.endDate}</dd></div>
              <div><dt className="text-muted-foreground">عدد الأيام</dt><dd className="font-numeric tabular-nums">{leave.days}</dd></div>
              {leave.notes && (
                <div className="col-span-2"><dt className="text-muted-foreground">ملاحظات</dt><dd>{leave.notes}</dd></div>
              )}
            </dl>
          </TabsContent>
          <TabsContent value="changes" className="mt-4" data-testid="tab-content-leave-changes">
            <div className="rounded-md border border-border max-h-96 overflow-hidden flex flex-col">
              <HistoryTimeline
                entityType="leave"
                entityId={leave.id}
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
  return (
    <p
      className={`text-xs mt-1 tabular-nums ${d.positive ? "text-green-600 dark:text-green-400" : "text-destructive"}`}
      data-testid={testId}
    >
      {d.text} مقارنة بالشهر السابق
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
      const res = await fetch(`/api/hr/payroll/preview?year=${year}&month=${month}`);
      if (!res.ok) throw new Error("تعذر التحميل");
      return res.json();
    },
  });

  const { data: prevData } = useQuery<{ year: number; month: number; lines: PreviewLine[] }>({
    queryKey: ["/api/hr/payroll/preview", { year: prevYear, month: prevMonth }],
    queryFn: async () => {
      const res = await fetch(`/api/hr/payroll/preview?year=${prevYear}&month=${prevMonth}`);
      if (!res.ok) throw new Error("تعذر التحميل");
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
      toast({ title: "✅ تم", description: "تم اعتماد الرواتب وتسجيل القيود المحاسبية تلقائياً" });
      queryClient.invalidateQueries({ queryKey: ["/api/journal-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/insights"] });
      queryClient.invalidateQueries({ queryKey: ["/api/hr/payroll/runs"] });
    },
    onError: (e: any) => toast({ title: "خطأ", description: e?.message, variant: "destructive" }),
  });

  const removeRun = useMutation({
    // We bypass the shared `apiRequest` helper here so we can read the JSON
    // body of an HTTP 409 response and surface its `message` exactly as the
    // server worded it ("القيد المحاسبي مرتبط بدورة إهلاك", etc.). The
    // helper coerces every non-2xx into `Error("<status>: <text>")`, which
    // would force us to string-parse for the conflict reason.
    mutationFn: async (id: number) => {
      const headers: Record<string, string> = {};
      if (typeof window !== "undefined") {
        const cid = window.localStorage.getItem("active_company_id");
        if (cid) headers["X-Company-Id"] = cid;
      }
      const res = await fetch(`/api/hr/payroll/runs/${id}`, {
        method: "DELETE",
        headers,
        credentials: "include",
      });
      if (res.status === 409) {
        let message = "تعذّر حذف كشف الرواتب: القيد المحاسبي مرتبط بسجلات أخرى.";
        try {
          const body = await res.json();
          if (body && typeof body.message === "string" && body.message.trim().length > 0) {
            message = body.message;
          }
        } catch {
          /* server didn't send JSON — keep the fallback message */
        }
        const err = new Error(message) as Error & { status?: number };
        err.status = 409;
        throw err;
      }
      if (!res.ok) {
        const text = (await res.text().catch(() => "")) || res.statusText;
        throw new Error(`${res.status}: ${text}`);
      }
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/payroll/runs"] });
      toast({ title: "تم", description: "تم حذف كشف الرواتب" });
    },
    onError: (e: any) => {
      if (e?.status === 409) {
        // Park the conflict reason in state so the modal alert below can
        // render it. Toasts auto-dismiss after a few seconds, and this
        // message tells the user *which* downstream module is holding the
        // journal entry — they often need long enough to read it, switch
        // tabs, and copy the reference out.
        setConflictMessage(String(e?.message ?? ""));
        return;
      }
      toast({ title: "خطأ", description: e?.message, variant: "destructive" });
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
  const monthsAr = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
  const fmtDelta = (cur: number, prev: number) => {
    const diff = cur - prev;
    const sign = diff >= 0 ? "+" : "−";
    return { text: `${sign}${fmt(Math.abs(diff))}`, positive: diff >= 0 };
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5" /> كشف رواتب الشهر</CardTitle>
          <CardDescription>
            سيتم تسجيل قيد محاسبي تلقائي عند الاعتماد: مصروف رواتب وتأمينات ومخصص نهاية خدمة (وفق IAS 19) مقابل النقدية والالتزامات.
            <br />الدولة المختارة: <span className="font-bold text-primary">{settings.countryCode}</span> — العملة: <span className="font-bold">{settings.currencySymbol}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div className="text-sm text-muted-foreground" data-testid="text-payroll-period">
              الفترة المعروضة: <span className="font-semibold text-foreground">{monthsAr[month - 1]} {year}</span>
              <span className="text-xs block mt-0.5">يتغيّر تلقائياً مع تغيّر الفترة في الأعلى.</span>
            </div>
            <div className="flex-1" />
            <WriteGuard forceDisabled={lines.length === 0 || run.isPending}>
              <Button
                size="lg"
                onClick={() => run.mutate()}
                data-testid="button-run-payroll"
              >
                <PlayCircle className="w-5 h-5 ml-2" />
                {run.isPending ? "جاري الاعتماد..." : "اعتماد الرواتب وتسجيل القيد"}
              </Button>
            </WriteGuard>
          </div>

          {isLoading ? (
            <ListSkeleton rows={5} testId="skeleton-payroll" />
          ) : error ? (
            <ErrorState
              title="تعذّر تحميل معاينة الرواتب"
              cause="حدث خلل أثناء حساب الكشف. حاول مرة أخرى أو راجع بيانات الموظفين."
              onRetry={() => refetch()}
              testId="error-payroll"
            />
          ) : lines.length === 0 ? (
            <EmptyState
              icon={<Users className="w-5 h-5" />}
              title="لا يوجد موظفون لحساب الرواتب"
              description="أضف موظفين من تبويب الموظفين أولاً، وستظهر معاينة كشف الرواتب هنا تلقائياً."
              testId="empty-payroll"
            />
          ) : (
            <>
              <div className="overflow-x-auto table-sticky-first">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الموظف</TableHead>
                      <TableHead>أساسي</TableHead>
                      <TableHead>بدلات</TableHead>
                      <TableHead>إضافي</TableHead>
                      <TableHead>غياب</TableHead>
                      <TableHead>تأمينات (موظف)</TableHead>
                      <TableHead>إجمالي</TableHead>
                      <TableHead className="font-bold">صافي</TableHead>
                      <TableHead>EoS</TableHead>
                      <TableHead>إجازات</TableHead>
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
                  <p className="text-xs text-muted-foreground">إجمالي قبل الخصم</p>
                  <p className="text-xl font-bold" data-testid="text-total-gross">{fmt(totals.gross)}</p>
                  {prevTotals && <DeltaLine d={fmtDelta(totals.gross, prevTotals.gross)} testId="text-delta-gross" />}
                </CardContent></Card>
                <Card className="bg-primary/10"><CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">صافي للصرف</p>
                  <p className="text-xl font-bold text-primary" data-testid="text-total-net">{fmt(totals.net)}</p>
                  {prevTotals && <DeltaLine d={fmtDelta(totals.net, prevTotals.net)} testId="text-delta-net" />}
                </CardContent></Card>
                <Card><CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">مخصص نهاية الخدمة (شهرياً)</p>
                  <p className="text-lg font-semibold" data-testid="text-total-eos">{fmt(totals.eos)}</p>
                  {prevTotals && <DeltaLine d={fmtDelta(totals.eos, prevTotals.eos)} testId="text-delta-eos" />}
                </CardContent></Card>
                <Card><CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">مخصص الإجازات (شهرياً)</p>
                  <p className="text-lg font-semibold" data-testid="text-total-leave">{fmt(totals.leave)}</p>
                  {prevTotals && <DeltaLine d={fmtDelta(totals.leave, prevTotals.leave)} testId="text-delta-leave" />}
                </CardContent></Card>
              </div>

              <div className="mt-4 p-3 bg-muted/30 rounded-md text-xs text-muted-foreground flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 text-primary shrink-0" />
                <p>
                  القيد التلقائي عند الاعتماد:
                  <span className="block mt-1"><strong>من ح/</strong> الرواتب والأجور ({fmt(totals.gross + totals.leave - lines.reduce((s, l) => s + l.absenceDeduction, 0))}) + اشتراكات تأمينات (المنشأة) ({fmt(totals.siEr)}) + مخصص نهاية الخدمة ({fmt(totals.eos)})</span>
                  <span className="block"><strong>إلى ح/</strong> النقدية ({fmt(totals.net)}) + تأمينات مستحقة ({fmt(totals.siEmp + totals.siEr)}) + التزام نهاية الخدمة ({fmt(totals.eos)}) + إجازات مستحقة ({fmt(totals.leave)})</span>
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5" /> كشوف الرواتب السابقة</CardTitle>
          <CardDescription>سجل كشوف الرواتب التي تم اعتمادها — افتح "السجل" لمراجعة من قام بكل خطوة (احتساب، اعتماد، حذف).</CardDescription>
        </CardHeader>
        <CardContent>
          {pastRuns.length === 0 ? (
            <EmptyState
              icon={<FileText className="w-5 h-5" />}
              title="لا توجد كشوف سابقة"
              description="بعد اعتماد أول كشف رواتب، سيظهر هنا مع كل التغييرات والتدقيق."
              testId="empty-payroll-runs"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الفترة</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>إجمالي قبل الخصم</TableHead>
                  <TableHead>صافي للصرف</TableHead>
                  <TableHead>القيد المحاسبي</TableHead>
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
                        ? <Badge variant="default">معتمد</Badge>
                        : <Badge variant="secondary">{r.status}</Badge>}
                    </TableCell>
                    <TableCell>{fmt(Number(r.totalGross))}</TableCell>
                    <TableCell className="font-bold text-primary">{fmt(Number(r.totalNet))}</TableCell>
                    <TableCell className="text-xs">
                      {r.journalEntryId ? (
                        <Link
                          href={`/app/journal#je-${r.journalEntryId}`}
                          className="font-numeric tabular-nums text-primary underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none rounded-sm"
                          data-testid={`link-journal-entry-${r.id}`}
                          title={`فتح قيد اليومية JE-${r.journalEntryId}`}
                        >
                          JE-{r.journalEntryId}
                        </Link>
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
        <AlertDialogContent dir="rtl" data-testid="dialog-payroll-delete-conflict">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-right">
              <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
              تعذّر حذف كشف الرواتب
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
              فهمت
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
  const gross = Number(run.totalGross);
  const net = Number(run.totalNet);
  const deductions = Math.max(0, gross - net);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-payroll-run-detail">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-numeric text-[11px] tabular-nums text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border">
              PR-{run.id}
            </span>
            <span className="truncate">كشف رواتب {monthLabel} {run.year}</span>
          </DialogTitle>
          <DialogDescription>تفاصيل كشف الرواتب وسجل التغييرات.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="summary">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="summary" data-testid="tab-payroll-run-summary">ملخص</TabsTrigger>
            <TabsTrigger value="lines" data-testid="tab-payroll-run-lines">السطور</TabsTrigger>
            <TabsTrigger value="changes" data-testid="tab-payroll-run-changes">التغييرات</TabsTrigger>
          </TabsList>
          <TabsContent value="summary" className="mt-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-muted-foreground">الكود</dt><dd className="font-mono">PR-{run.id}</dd></div>
              <div>
                <dt className="text-muted-foreground">الحالة</dt>
                <dd>
                  {run.status === "posted"
                    ? <Badge variant="default">معتمد</Badge>
                    : <Badge variant="secondary">{run.status}</Badge>}
                </dd>
              </div>
              <div><dt className="text-muted-foreground">الفترة</dt><dd className="font-numeric tabular-nums">{monthLabel} {run.year}</dd></div>
              <div>
                <dt className="text-muted-foreground">القيد المحاسبي</dt>
                <dd>
                  {run.journalEntryId ? (
                    <Link
                      href={`/app/journal#je-${run.journalEntryId}`}
                      className="font-numeric tabular-nums text-primary underline-offset-4 hover:underline"
                      data-testid={`link-detail-journal-entry-${run.id}`}
                    >
                      JE-{run.journalEntryId}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </dd>
              </div>
              <div><dt className="text-muted-foreground">إجمالي قبل الخصم</dt><dd className="font-numeric tabular-nums" data-testid="text-detail-total-gross">{fmt(gross)}</dd></div>
              <div><dt className="text-muted-foreground">صافي للصرف</dt><dd className="font-numeric tabular-nums font-bold text-primary" data-testid="text-detail-total-net">{fmt(net)}</dd></div>
              <div><dt className="text-muted-foreground">إجمالي الخصومات</dt><dd className="font-numeric tabular-nums" data-testid="text-detail-total-deductions">{fmt(deductions)}</dd></div>
              {run.createdAt && (
                <div><dt className="text-muted-foreground">تاريخ الإنشاء</dt><dd className="font-numeric tabular-nums">{new Date(run.createdAt).toISOString().slice(0, 10)}</dd></div>
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
  const { data, isLoading, error, refetch } = useQuery<PayrollLineWithEmployee[]>({
    queryKey: ["/api/hr/payroll/runs", runId, "lines"],
    queryFn: async () => {
      const res = await fetch(`/api/hr/payroll/runs/${runId}/lines`);
      if (!res.ok) throw new Error("تعذر تحميل تفاصيل كشف الرواتب");
      return res.json();
    },
  });

  if (isLoading) {
    return <ListSkeleton rows={4} testId="loading-payroll-run-lines" />;
  }
  if (error) {
    return (
      <ErrorState
        title="تعذّر تحميل تفاصيل كشف الرواتب"
        cause="حدث خلل أثناء جلب سطور الكشف. حاول مرة أخرى."
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
        title="لا توجد سطور لهذا الكشف"
        description="لم يتم تسجيل أي سطور موظفين لهذا الكشف."
        testId="empty-payroll-run-lines"
      />
    );
  }
  return (
    <div className="overflow-x-auto table-sticky-first" data-testid="table-payroll-run-lines">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>الموظف</TableHead>
            <TableHead>أساسي</TableHead>
            <TableHead>بدلات</TableHead>
            <TableHead>إضافي</TableHead>
            <TableHead>غياب</TableHead>
            <TableHead>تأمينات (موظف)</TableHead>
            <TableHead>إجمالي</TableHead>
            <TableHead className="font-bold">صافي</TableHead>
            <TableHead>EoS</TableHead>
            <TableHead>إجازات</TableHead>
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
