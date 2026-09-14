import { useEffect, useState } from 'react';
import { useListUsers, useCreateUser, useUpdateUser, useDeleteUser, type User } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { getListUsersQueryKey } from '@workspace/api-client-react';
import {
  UserPlus,
  Shield,
  Eye,
  Warehouse,
  Pencil,
  UserCheck,
  UserX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { useGetCurrentUser } from '@workspace/api-client-react';
import { useLocation } from 'wouter';
import { formatDate } from '@/lib/utils';
import { validateUsername } from '@/lib/user-validation';

type Role = 'admin' | 'warehouse_manager' | 'viewer';

const roleConfig: Record<Role, { label: string; icon: React.ReactNode; color: string; desc: string }> = {
  admin: {
    label: 'مدير نظام',
    icon: <Shield className="h-3 w-3" />,
    color: 'bg-destructive/10 text-destructive border-destructive/30 border',
    desc: 'صلاحية كاملة على جميع الوظائف وإدارة المستخدمين',
  },
  warehouse_manager: {
    label: 'أمين مستودع',
    icon: <Warehouse className="h-3 w-3" />,
    color: 'bg-primary/10 text-primary border-primary/30 border',
    desc: 'إدخال وإخراج المواد وعرض التقارير',
  },
  viewer: {
    label: 'مراقب',
    icon: <Eye className="h-3 w-3" />,
    color: 'bg-muted text-muted-foreground border border-border',
    desc: 'عرض البيانات والتقارير فقط بدون تعديل',
  },
};

function RoleBadge({ role }: { role: string }) {
  const cfg = roleConfig[role as Role] ?? roleConfig.viewer;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${cfg.color}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

interface UserFormState {
  fullName: string;
  username: string;
  password: string;
  role: Role;
  isActive: boolean;
}

const defaultForm: UserFormState = {
  fullName: '',
  username: '',
  password: '',
  role: 'warehouse_manager',
  isActive: true,
};

export function UsersPage() {
  const [, setLocation] = useLocation();
  const { data: currentUser } = useGetCurrentUser();

  // Redirect non-admins
  useEffect(() => {
    if (currentUser && currentUser.role !== 'admin') setLocation('/');
  }, [currentUser, setLocation]);

  if (currentUser && currentUser.role !== 'admin') return null;

  return <UsersList currentUserId={currentUser?.id} />;
}

function UsersList({ currentUserId }: { currentUserId?: number }) {
  const queryClient = useQueryClient();
  const { data: users = [], isLoading, isError, refetch } = useListUsers();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [form, setForm] = useState<UserFormState>(defaultForm);
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof UserFormState, string>>>({});

  const createUser = useCreateUser({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        toast.success('تم إضافة المستخدم بنجاح');
        setDialogOpen(false);
      },
      onError: (err: unknown) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        if (msg?.includes('unique') || msg?.includes('Username already exists') || msg?.includes('موجود')) {
          setFormErrors((e) => ({ ...e, username: 'اسم المستخدم موجود مسبقاً' }));
        } else {
          toast.error('حدث خطأ أثناء الإضافة');
        }
      },
    },
  });

  const updateUser = useUpdateUser({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        toast.success('تم تحديث المستخدم بنجاح');
        setDialogOpen(false);
      },
      onError: () => toast.error('حدث خطأ أثناء التحديث'),
    },
  });

  const deleteUser = useDeleteUser({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        toast.success('تم تعطيل المستخدم');
        setDeleteTarget(null);
      },
      onError: () => toast.error('حدث خطأ أثناء التعطيل'),
    },
  });

  const toggleActive = (user: User) => {
    updateUser.mutate(
      { id: user.id, data: { isActive: !user.isActive } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
          toast.success(user.isActive ? 'تم تعطيل الحساب' : 'تم تفعيل الحساب');
        },
      }
    );
  };

  const openAdd = () => {
    setEditingUser(null);
    setForm(defaultForm);
    setFormErrors({});
    setDialogOpen(true);
  };

  const openEdit = (user: User) => {
    setEditingUser(user);
    setForm({
      fullName: user.fullName,
      username: user.username,
      password: '',
      role: user.role as Role,
      isActive: user.isActive ?? true,
    });
    setFormErrors({});
    setDialogOpen(true);
  };

  const validate = (): boolean => {
    const errs: Partial<Record<keyof UserFormState, string>> = {};
    if (!form.fullName.trim()) errs.fullName = 'الاسم الكامل مطلوب';
    if (!editingUser && !form.username.trim()) errs.username = 'اسم المستخدم مطلوب';
    if (!editingUser && !errs.username) {
      const usernameError = validateUsername(form.username);
      if (usernameError) errs.username = usernameError;
    }
    if (!editingUser && !form.password.trim()) errs.password = 'كلمة المرور مطلوبة';
    if (
      form.password &&
      (
        form.password.length < 12 ||
        !/[A-Z]/.test(form.password) ||
        !/[a-z]/.test(form.password) ||
        !/[0-9]/.test(form.password) ||
        !/[^A-Za-z0-9]/.test(form.password)
      )
    ) {
      errs.password = 'كلمة المرور: 12 حرفاً مع حرف كبير وصغير ورقم ورمز';
    }
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    if (editingUser) {
      const data: Record<string, unknown> = { fullName: form.fullName, role: form.role, isActive: form.isActive };
      if (form.password) data.password = form.password;
      updateUser.mutate({ id: editingUser.id, data });
    } else {
      createUser.mutate({
        data: {
          fullName: form.fullName,
          username: form.username,
          password: form.password,
          role: form.role,
        },
      });
    }
  };

  const isBusy = createUser.isPending || updateUser.isPending;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">إدارة المستخدمين</h1>
          <p className="text-sm text-muted-foreground mt-1">
            إضافة وتعديل حسابات المستخدمين وصلاحياتهم
          </p>
        </div>
        <Button onClick={openAdd} className="gap-2">
          <UserPlus className="h-4 w-4" />
          مستخدم جديد
        </Button>
      </div>

      {/* Table */}
      <div className="bg-card border rounded-lg shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الاسم الكامل</TableHead>
                <TableHead>اسم المستخدم</TableHead>
                <TableHead>الدور</TableHead>
                <TableHead className="text-center">الحالة</TableHead>
                <TableHead>تاريخ الإنشاء</TableHead>
                <TableHead className="w-[120px] text-center">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
                      <span>جاري التحميل...</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : isError ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center">
                    <p className="text-sm text-destructive">تعذر تحميل المستخدمين. حاول مرة أخرى.</p>
                    <Button variant="outline" size="sm" className="mt-3" onClick={() => void refetch()}>إعادة المحاولة</Button>
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                    لا يوجد مستخدمون مسجلون
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => (
                  <TableRow key={user.id} className={!user.isActive ? 'opacity-50' : ''}>
                    <TableCell className="font-medium">{user.fullName}</TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">
                      {user.username}
                      {user.id === currentUserId && (
                        <span className="mr-2 text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                          أنت
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <RoleBadge role={user.role} />
                    </TableCell>
                    <TableCell className="text-center">
                      {user.isActive ? (
                        <Badge className="bg-success/10 text-success border border-success/30 text-xs">نشط</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground text-xs">معطل</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(user.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEdit(user)}
                          title="تعديل"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {user.id !== currentUserId && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => user.isActive ? setDeleteTarget(user) : toggleActive(user)}
                              title={user.isActive ? 'تعطيل الحساب' : 'تفعيل الحساب'}
                            >
                              {user.isActive ? (
                                <UserX className="h-4 w-4 text-warning" />
                              ) : (
                                <UserCheck className="h-4 w-4 text-success" />
                              )}
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingUser ? 'تعديل مستخدم' : 'إضافة مستخدم جديد'}</DialogTitle>
            <DialogDescription>
              {editingUser
                ? 'قم بتعديل بيانات المستخدم. اتركِ كلمة المرور فارغة للإبقاء على الحالية.'
                : 'أدخل بيانات المستخدم الجديد.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Full Name */}
            <div className="space-y-1.5">
              <Label htmlFor="fullName">الاسم الكامل <span className="text-destructive">*</span></Label>
              <Input
                id="fullName"
                value={form.fullName}
                onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                placeholder="مثال: محمد أحمد"
              />
              {formErrors.fullName && (
                <p className="text-xs text-destructive">{formErrors.fullName}</p>
              )}
            </div>

            {/* Username (add only) */}
            {!editingUser && (
              <div className="space-y-1.5">
                <Label htmlFor="username">اسم المستخدم <span className="text-destructive">*</span></Label>
                <Input
                  id="username"
                  value={form.username}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                  placeholder="مثال: m.ahmad"
                  dir="ltr"
                />
                {formErrors.username && (
                  <p className="text-xs text-destructive">{formErrors.username}</p>
                )}
              </div>
            )}

            {/* Password */}
            <div className="space-y-1.5">
              <Label htmlFor="password">
                كلمة المرور{' '}
                {!editingUser && <span className="text-destructive">*</span>}
                {editingUser && (
                  <span className="text-muted-foreground text-xs font-normal">(اتركها فارغة للإبقاء على الحالية)</span>
                )}
              </Label>
              <Input
                id="password"
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder={editingUser ? '••••••••' : '12 حرفاً: كبير وصغير ورقم ورمز'}
                dir="ltr"
              />
              {formErrors.password && (
                <p className="text-xs text-destructive">{formErrors.password}</p>
              )}
            </div>

            {/* Role */}
            <div className="space-y-1.5">
              <Label>الدور <span className="text-destructive">*</span></Label>
              <Select
                value={form.role}
                onValueChange={(v) => setForm((f) => ({ ...f, role: v as Role }))}
                disabled={!!(editingUser && editingUser.id === currentUserId)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(roleConfig) as Role[]).map((r) => (
                    <SelectItem key={r} value={r}>
                      <div className="flex flex-col gap-0.5">
                        <span>{roleConfig[r].label}</span>
                        <span className="text-xs text-muted-foreground">{roleConfig[r].desc}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editingUser && editingUser.id === currentUserId && (
                <p className="text-xs text-muted-foreground">لا يمكن تغيير دورك بنفسك لتجنب فقدان الصلاحيات</p>
              )}
            </div>

            {/* Active status (edit only) */}
            {editingUser && (
              <div className="space-y-1.5">
                <Label>حالة الحساب</Label>
                <Select
                  value={form.isActive ? 'active' : 'inactive'}
                  onValueChange={(v) => setForm((f) => ({ ...f, isActive: v === 'active' }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">نشط</SelectItem>
                    <SelectItem value="inactive">معطل</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isBusy}>
              إلغاء
            </Button>
            <Button onClick={handleSubmit} disabled={isBusy}>
              {isBusy ? 'جاري الحفظ...' : editingUser ? 'حفظ التعديلات' : 'إضافة المستخدم'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد تعطيل الحساب</AlertDialogTitle>
            <AlertDialogDescription>
              هل تريد تعطيل حساب <strong>{deleteTarget?.fullName}</strong>؟ سيتم إيقاف تسجيل الدخول فقط، ولن يُحذف سجل المستخدم أو عملياته.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteUser.mutate({ id: deleteTarget.id })}
              disabled={deleteUser.isPending}
            >
              {deleteUser.isPending ? 'جاري التعطيل...' : 'تأكيد التعطيل'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
