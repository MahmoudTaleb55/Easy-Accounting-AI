import { useState } from "react";
import { Link } from "wouter";
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
import { WriteGuard } from "@/components/auth/write-guard";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Users, Plus, Trash2, Calendar, FileText, PlayCircle, AlertCircle, CheckCircle2, History } from "lucide-react";
import { ListSkeleton } from "@/components/feedback/list-skeleton";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { HistoryDrawer, HistoryTimeline } from "@/components/audit/history-drawer";
import { PeriodChip } from "@/components/dashboard/period-chip";
import { usePeriod } from "@/contexts/period-context";
import type { Employee, Leave, Attendance, PayrollRun } from "@shared/schema";

// ====================================================================
// Page wrapper
// ====================================================================

export default function HRPage() {
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

      <Tabs defaultValue="employees" className="space-y-4">
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
  const [historyEmp, setHistoryEmp] = useState<Employee | null>(null);
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
                      <Button variant="ghost" size="icon" onClick={() => setHistoryEmp(e)} aria-label="السجل" data-testid={`button-history-employee-${e.id}`}>
                        <History className="w-4 h-4" />
                      </Button>
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
      <HistoryDrawer
        open={!!historyEmp}
        onOpenChange={(o) => { if (!o) setHistoryEmp(null); }}
        title={historyEmp?.fullName || ""}
        reference={historyEmp ? `EMP-${historyEmp.id}` : undefined}
        entityType="employee"
        entityId={historyEmp?.id}
      />
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
  const [historyAtt, setHistoryAtt] = useState<Attendance | null>(null);
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
                    <TableCell>{r.date}</TableCell>
                    <TableCell>{empName(r.employeeId)}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "absent" ? "destructive" : "default"}>{statusLabel[r.status] || r.status}</Badge>
                    </TableCell>
                    <TableCell>{Number(r.overtimeHours)}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => setHistoryAtt(r)} aria-label="السجل" data-testid={`button-history-att-${r.id}`}>
                        <History className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <HistoryDrawer
        open={!!historyAtt}
        onOpenChange={(o) => { if (!o) setHistoryAtt(null); }}
        title={historyAtt ? `${empName(historyAtt.employeeId)} — ${historyAtt.date}` : ""}
        reference={historyAtt ? `ATT-${historyAtt.id}` : undefined}
        entityType="attendance"
        entityId={historyAtt?.id}
      />
    </div>
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
  const [historyLeave, setHistoryLeave] = useState<Leave | null>(null);

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
                    <TableCell>{empName(l.employeeId)}</TableCell>
                    <TableCell>{l.startDate}</TableCell>
                    <TableCell>{l.endDate}</TableCell>
                    <TableCell>{l.days}</TableCell>
                    <TableCell><Badge variant="outline">{typeLabel[l.type] || l.type}</Badge></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" onClick={() => setHistoryLeave(l)} aria-label="السجل" data-testid={`button-history-leave-${l.id}`}>
                          <History className="w-4 h-4" />
                        </Button>
                        <WriteGuard>
                          <Button variant="ghost" size="icon" onClick={() => remove.mutate(l.id)} data-testid={`button-delete-leave-${l.id}`}>
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
      </Card>
      <HistoryDrawer
        open={!!historyLeave}
        onOpenChange={(o) => { if (!o) setHistoryLeave(null); }}
        title={historyLeave ? `${empName(historyLeave.employeeId)} — ${typeLabel[historyLeave.type] || historyLeave.type}` : ""}
        reference={historyLeave ? `LV-${historyLeave.id}` : undefined}
        entityType="leave"
        entityId={historyLeave?.id}
      />
    </div>
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
  const [historyRun, setHistoryRun] = useState<PayrollRun | null>(null);

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
    mutationFn: async (id: number) => await apiRequest("DELETE", `/api/hr/payroll/runs/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/payroll/runs"] });
      toast({ title: "تم", description: "تم حذف كشف الرواتب" });
    },
    onError: (e: any) => toast({ title: "خطأ", description: e?.message, variant: "destructive" }),
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
                  <TableRow key={r.id} data-testid={`row-payroll-run-${r.id}`}>
                    <TableCell className="font-medium font-numeric tabular-nums">
                      {String(r.month).padStart(2, "0")}/{r.year}
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
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setHistoryRun(r)}
                          aria-label="السجل"
                          data-testid={`button-history-payroll-run-${r.id}`}
                        >
                          <History className="w-4 h-4" />
                        </Button>
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
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <HistoryDrawer
        open={!!historyRun}
        onOpenChange={(o) => { if (!o) setHistoryRun(null); }}
        title={historyRun ? `كشف رواتب ${String(historyRun.month).padStart(2, "0")}/${historyRun.year}` : ""}
        reference={historyRun ? `PR-${historyRun.id}` : undefined}
        entityType="payroll_run"
        entityId={historyRun?.id}
      />
    </div>
  );
}
