import { useState } from "react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Users, Plus, Trash2, Calendar, FileText, PlayCircle, AlertCircle, CheckCircle2 } from "lucide-react";
import type { Employee, Leave } from "@shared/schema";

// ====================================================================
// Page wrapper
// ====================================================================

export default function HRPage() {
  return (
    <div className="space-y-8" data-testid="hr-page">
      <header className="space-y-2">
        <div className="eyebrow text-muted-foreground/80">الموارد والأصول</div>
        <h1
          className="font-display text-3xl md:text-4xl tracking-tight text-foreground"
          data-testid="text-page-title"
        >
          فريقك ورواتبه — في مكان واحد.
        </h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          الموظفون، الحضور، الإجازات وكشوف الرواتب — مع تسجيل تلقائي للقيود وفق IFRS / IAS 19.
        </p>
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
          <DialogTrigger asChild>
            <Button data-testid="button-add-employee"><Plus className="w-4 h-4 ml-2" /> موظف جديد</Button>
          </DialogTrigger>
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
          <p className="text-muted-foreground">جاري التحميل...</p>
        ) : employees.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>لا يوجد موظفون بعد. أضف أول موظف للبدء.</p>
          </div>
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
                  <TableCell className="font-medium">{e.fullName}</TableCell>
                  <TableCell>{e.jobTitle || "—"}</TableCell>
                  <TableCell>{e.hireDate}</TableCell>
                  <TableCell>{fmt(e.baseSalary)}</TableCell>
                  <TableCell>{fmt(e.allowances)}</TableCell>
                  <TableCell>
                    {e.isActive ? <Badge variant="default">نشط</Badge> : <Badge variant="secondary">معطل</Badge>}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => remove.mutate(e.id)} data-testid={`button-delete-employee-${e.id}`}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
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
  const yearMonth = date.slice(0, 7);

  const { data: employees = [] } = useQuery<Employee[]>({ queryKey: ["/api/hr/employees"] });
  const { data: records = [] } = useQuery<any[]>({
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
          <Button className="w-full" onClick={() => save.mutate()} disabled={!employeeId || save.isPending} data-testid="button-save-attendance">
            {save.isPending ? "..." : "حفظ"}
          </Button>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader><CardTitle>سجلات شهر {yearMonth}</CardTitle></CardHeader>
        <CardContent>
          {records.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">لا توجد سجلات حتى الآن.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>التاريخ</TableHead><TableHead>الموظف</TableHead><TableHead>الحالة</TableHead><TableHead>ساعات إضافية</TableHead></TableRow>
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
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
          <Button className="w-full" onClick={() => create.mutate()} disabled={!employeeId || !start || !end || create.isPending} data-testid="button-save-leave">
            {create.isPending ? "..." : "حفظ"}
          </Button>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader><CardTitle>سجل الإجازات</CardTitle></CardHeader>
        <CardContent>
          {leaves.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">لا توجد إجازات.</p>
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
                      <Button variant="ghost" size="icon" onClick={() => remove.mutate(l.id)} data-testid={`button-delete-leave-${l.id}`}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ====================================================================
// Payroll Run tab
// ====================================================================

interface PreviewLine {
  employeeId: number; fullName: string; absentDays: number; baseSalary: number;
  allowances: number; overtime: number; absenceDeduction: number; socialInsuranceEmployee: number;
  socialInsuranceEmployer: number; endOfServiceAccrual: number; leaveAccrual: number; gross: number; netPay: number;
}

function PayrollTab() {
  const { toast } = useToast();
  const fmt = useFormatMoney();
  const settings = useSettings();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const { data, isLoading, error } = useQuery<{ year: number; month: number; lines: PreviewLine[] }>({
    queryKey: ["/api/hr/payroll/preview", { year, month }],
    queryFn: async () => {
      const res = await fetch(`/api/hr/payroll/preview?year=${year}&month=${month}`);
      if (!res.ok) throw new Error("تعذر التحميل");
      return res.json();
    },
  });

  const run = useMutation({
    mutationFn: async () => await apiRequest("POST", "/api/hr/payroll/run", { year, month }),
    onSuccess: () => {
      toast({ title: "✅ تم", description: "تم اعتماد الرواتب وتسجيل القيود المحاسبية تلقائياً" });
      queryClient.invalidateQueries({ queryKey: ["/api/journal-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/insights"] });
    },
    onError: (e: any) => toast({ title: "خطأ", description: e?.message, variant: "destructive" }),
  });

  const lines = data?.lines || [];
  const totals = lines.reduce(
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
            <div>
              <label className="text-sm font-medium">السنة</label>
              <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-24" data-testid="input-year" />
            </div>
            <div>
              <label className="text-sm font-medium">الشهر</label>
              <Input type="number" min="1" max="12" value={month} onChange={(e) => setMonth(Number(e.target.value))} className="w-24" data-testid="input-month" />
            </div>
            <Button
              size="lg"
              onClick={() => run.mutate()}
              disabled={lines.length === 0 || run.isPending}
              data-testid="button-run-payroll"
            >
              <PlayCircle className="w-5 h-5 ml-2" />
              {run.isPending ? "جاري الاعتماد..." : "اعتماد الرواتب وتسجيل القيد"}
            </Button>
          </div>

          {isLoading ? (
            <p className="text-muted-foreground">جاري حساب المعاينة...</p>
          ) : error ? (
            <p className="text-destructive flex items-center gap-2"><AlertCircle className="w-4 h-4" /> تعذر التحميل</p>
          ) : lines.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>أضف موظفين أولاً لحساب الرواتب.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
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
                <Card className="bg-primary/5"><CardContent className="p-4"><p className="text-xs text-muted-foreground">إجمالي قبل الخصم</p><p className="text-xl font-bold" data-testid="text-total-gross">{fmt(totals.gross)}</p></CardContent></Card>
                <Card className="bg-primary/10"><CardContent className="p-4"><p className="text-xs text-muted-foreground">صافي للصرف</p><p className="text-xl font-bold text-primary" data-testid="text-total-net">{fmt(totals.net)}</p></CardContent></Card>
                <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">مخصص نهاية الخدمة (شهرياً)</p><p className="text-lg font-semibold" data-testid="text-total-eos">{fmt(totals.eos)}</p></CardContent></Card>
                <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">مخصص الإجازات (شهرياً)</p><p className="text-lg font-semibold" data-testid="text-total-leave">{fmt(totals.leave)}</p></CardContent></Card>
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
    </div>
  );
}
