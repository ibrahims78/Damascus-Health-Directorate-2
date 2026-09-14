import { useState, useEffect } from 'react';
import { useRoute, useLocation, Link } from 'wouter';
import { useListTransactions, type Transaction } from '@workspace/api-client-react';
import {
  ChevronRight,
  ChevronLeft,
  Printer,
  PackagePlus,
  PackageMinus,
  Search,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime } from '@/lib/utils';
import { CopyButton } from '@/components/copy-button';
import { TransactionInForm } from './transaction-in-form';
import { TransactionOutForm } from './transaction-out-form';

export function TransactionsPage() {
  const [matchIn] = useRoute('/transactions/in/new');
  const [matchOut] = useRoute('/transactions/out/new');

  if (matchIn) return <TransactionInForm />;
  if (matchOut) return <TransactionOutForm />;
  return <TransactionsList />;
}

const PAGE_SIZE = 50;

type TypeFilter =
  | 'all'
  | 'in'
  | 'out'
  | 'adjust'
  | 'custody_out'
  | 'custody_return'
  | 'damage'
  | 'central_return';
type ItemTypeFilter = 'all' | 'item' | 'equipment';

/** Debounce a value by `delay` ms â€” avoids a new API call on every keystroke */
function useDebounce<T>(value: T, delay = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function typeBadge(type: string) {
  if (type === 'in')
    return (
      <Badge className="bg-success/15 text-success border-success/30 border text-xs font-medium">
        Ø¥Ø¯Ø®Ø§Ù„
      </Badge>
    );
  if (type === 'out')
    return (
      <Badge variant="destructive" className="text-xs font-medium">
        Ø¥Ø®Ø±Ø§Ø¬
      </Badge>
    );
  if (type === 'adjust')
    return (
      <Badge className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700 border text-xs font-medium">
        ØªØ³ÙˆÙŠØ© Ø¬Ø±Ø¯
      </Badge>
    );
  return (
    <Badge
      variant="secondary"
      className={`text-xs font-medium ${type === 'custody_out' || type === 'custody_return' ? 'border-blue-300 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : type === 'damage' ? 'border-red-300 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : type === 'central_return' ? 'border-purple-300 bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' : ''}`}
    >
      {type === 'custody_out'
        ? 'ØªØ³Ù„ÙŠÙ… Ø¹Ù‡Ø¯Ø©'
        : type === 'custody_return'
          ? 'Ø¥Ø¹Ø§Ø¯Ø© Ø¹Ù‡Ø¯Ø©'
          : type === 'damage'
            ? 'ØªÙ„Ù'
            : type === 'central_return'
              ? 'Ù…Ø±ØªØ¬Ø¹ Ù…Ø±ÙƒØ²ÙŠ'
              : 'Ø±ØµÙŠØ¯ Ø§ÙØªØªØ§Ø­ÙŠ'}
    </Badge>
  );
}

function TransactionsList() {
  const [, setLocation] = useLocation();
  const [page, setPage] = useState(1);
  const initialParams = new URLSearchParams(window.location.search);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(() => {
    const value = initialParams.get('type');
    return ['all', 'in', 'out', 'adjust', 'custody_out', 'custody_return', 'damage', 'central_return'].includes(value ?? '')
      ? (value as TypeFilter)
      : 'all';
  });
  const [itemTypeFilter, setItemTypeFilter] = useState<ItemTypeFilter>(() => {
    const value = initialParams.get('itemType');
    return ['all', 'item', 'equipment'].includes(value ?? '') ? (value as ItemTypeFilter) : 'all';
  });
  const [fromDate, setFromDate] = useState(() => initialParams.get('from') ?? '');
  const [toDate, setToDate] = useState(() => initialParams.get('to') ?? '');
  const [searchInput, setSearchInput] = useState(() => {
    return initialParams.get('search') ?? '';
  });
  const search = useDebounce(searchInput, 400);
  const dateRangeError = fromDate && toDate && fromDate > toDate
    ? 'ØªØ§Ø±ÙŠØ® Ø§Ù„Ø¨Ø¯Ø§ÙŠØ© Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø£Ù† ÙŠØªØ¬Ø§ÙˆØ² ØªØ§Ø±ÙŠØ® Ø§Ù„Ù†Ù‡Ø§ÙŠØ©'
    : '';

  useEffect(() => {
    const params = new URLSearchParams();
    if (typeFilter !== 'all') params.set('type', typeFilter);
    if (itemTypeFilter !== 'all') params.set('itemType', itemTypeFilter);
    if (fromDate) params.set('from', fromDate);
    if (toDate) params.set('to', toDate);
    if (searchInput.trim()) params.set('search', searchInput.trim());
    const query = params.toString();
    window.history.replaceState(null, '', query ? `/transactions?${query}` : '/transactions');
  }, [typeFilter, itemTypeFilter, fromDate, toDate, searchInput]);

  const { data, isLoading } = useListTransactions(
    {
      type: typeFilter === 'all' ? undefined : typeFilter,
      itemType: itemTypeFilter === 'all' ? undefined : itemTypeFilter,
      from: fromDate || undefined,
      to: toDate || undefined,
      search: search || undefined,
      page,
      limit: PAGE_SIZE,
    },
    { query: { enabled: !dateRangeError } as any },
  );

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  const resetFilters = () => {
    setTypeFilter('all');
    setItemTypeFilter('all');
    setFromDate('');
    setToDate('');
    setSearchInput('');
    setPage(1);
  };

  const hasFilters =
    typeFilter !== 'all' ||
    itemTypeFilter !== 'all' ||
    fromDate !== '' ||
    toDate !== '' ||
    searchInput !== '';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl font-bold tracking-tight">Ø³Ø¬Ù„ Ø§Ù„Ø¹Ù…Ù„ÙŠØ§Øª</h1>
        <div className="flex gap-2">
          <Button
            onClick={() => setLocation('/transactions/in/new')}
            className="gap-2 bg-success hover:bg-success/90 text-white"
          >
            <PackagePlus className="w-4 h-4" />
            Ø¥Ø¯Ø®Ø§Ù„ Ù…Ø§Ø¯Ø©
          </Button>
          <Button
            onClick={() => setLocation('/transactions/out/new')}
            variant="destructive"
            className="gap-2"
          >
            <PackageMinus className="w-4 h-4" />
            Ø¥Ø®Ø±Ø§Ø¬ Ù…Ø§Ø¯Ø©
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-card border rounded-lg shadow-sm p-4 space-y-3">
        {/* Search row */}
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Ø¨Ø­Ø« Ø¨Ø±Ù‚Ù… Ø§Ù„Ø³Ù†Ø¯ Ø£Ùˆ Ø§Ø³Ù… Ø§Ù„Ù…Ø§Ø¯Ø© Ø£Ùˆ Ø§Ù„Ø¬Ù‡Ø© Ø§Ù„Ù…Ø³ØªÙ„Ù…Ø©..."
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              setPage(1);
            }}
            className="pr-9 pl-8"
          />
          {searchInput && (
            <button
              onClick={() => { setSearchInput(''); setPage(1); }}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Ù…Ø³Ø­ Ø§Ù„Ø¨Ø­Ø«"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground/80">Ù†ÙˆØ¹ Ø§Ù„Ø¹Ù…Ù„ÙŠØ©</label>
            <Select
              value={typeFilter}
              onValueChange={(v) => {
                setTypeFilter(v as TypeFilter);
                setPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Ø§Ù„ÙƒÙ„</SelectItem>
                <SelectItem value="in">Ø¥Ø¯Ø®Ø§Ù„ ÙÙ‚Ø·</SelectItem>
                <SelectItem value="out">Ø¥Ø®Ø±Ø§Ø¬ ÙÙ‚Ø·</SelectItem>
                <SelectItem value="adjust">ØªØ³ÙˆÙŠØ© Ø¬Ø±Ø¯ ÙÙ‚Ø·</SelectItem>
                <SelectItem value="custody_out">ØªØ³Ù„ÙŠÙ… Ø¹Ù‡Ø¯Ø© ÙÙ‚Ø·</SelectItem>
                <SelectItem value="custody_return">Ø¥Ø¹Ø§Ø¯Ø© Ø¹Ù‡Ø¯Ø© ÙÙ‚Ø·</SelectItem>
                <SelectItem value="damage">ØªÙ„Ù ÙÙ‚Ø·</SelectItem>
                <SelectItem value="central_return">Ù…Ø±ØªØ¬Ø¹ Ù…Ø±ÙƒØ²ÙŠ ÙÙ‚Ø·</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground/80">Ù†ÙˆØ¹ Ø§Ù„ØµÙ†Ù</label>
            <Select
              value={itemTypeFilter}
              onValueChange={(v) => {
                setItemTypeFilter(v as ItemTypeFilter);
                setPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Ø§Ù„ÙƒÙ„</SelectItem>
                <SelectItem value="item">Ù…Ø§Ø¯Ø© / Ù…Ø³ØªÙ‡Ù„Ùƒ</SelectItem>
                <SelectItem value="equipment">ØªØ¬Ù‡ÙŠØ² / Ù…Ø¹Ø¯Ø©</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground/80">Ù…Ù† ØªØ§Ø±ÙŠØ®</label>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground/80">Ø¥Ù„Ù‰ ØªØ§Ø±ÙŠØ®</label>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>

        {hasFilters && (
          <div className="mt-3 flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="text-muted-foreground h-7 text-xs"
            >
              Ø¥Ø¹Ø§Ø¯Ø© Ø¶Ø¨Ø· Ø§Ù„ÙÙ„Ø§ØªØ±
            </Button>
          </div>
        )}
      </div>

      {/* Table */}
      {dateRangeError && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {dateRangeError}
        </div>
      )}
      <div className="bg-card border rounded-lg shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ø±Ù‚Ù… Ø§Ù„Ø³Ù†Ø¯</TableHead>
                <TableHead>Ø§Ù„ØªØ§Ø±ÙŠØ®</TableHead>
                <TableHead>Ø§Ù„Ù†ÙˆØ¹</TableHead>
                <TableHead>Ø§Ù„ØµÙ†Ù</TableHead>
                <TableHead className="text-center">Ø§Ù„ÙƒÙ…ÙŠØ©</TableHead>
                <TableHead>Ø§Ù„Ø¬Ù‡Ø© Ø§Ù„Ù…Ø³ØªÙ„Ù…Ø©</TableHead>
                <TableHead>Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù…</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
                      <span>Ø¬Ø§Ø±ÙŠ Ø§Ù„ØªØ­Ù…ÙŠÙ„...</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : !data?.transactions.length ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                    {hasFilters
                      ? 'Ù„Ø§ ØªÙˆØ¬Ø¯ Ø¹Ù…Ù„ÙŠØ§Øª ØªØ·Ø§Ø¨Ù‚ Ø§Ù„ÙÙ„Ø§ØªØ± Ø§Ù„Ù…Ø­Ø¯Ø¯Ø©'
                      : 'Ù„Ø§ ØªÙˆØ¬Ø¯ Ø¹Ù…Ù„ÙŠØ§Øª Ù…Ø³Ø¬Ù„Ø© Ø¨Ø¹Ø¯ â€” Ø§Ø¨Ø¯Ø£ Ø¨ØªØ³Ø¬ÙŠÙ„ Ø¥Ø¯Ø®Ø§Ù„ Ø£Ùˆ Ø¥Ø®Ø±Ø§Ø¬'}
                  </TableCell>
                </TableRow>
              ) : (
                data.transactions.map((tx: Transaction) => {
                  const itemName =
                    tx.itemType === 'equipment' ? tx.equipmentName : tx.itemName;

                  return (
                    <TableRow key={tx.id} className="hover:bg-muted/40 cursor-default">
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          {tx.documentNumber}
                          <CopyButton value={tx.documentNumber} label="Ø±Ù‚Ù… Ø§Ù„Ø³Ù†Ø¯" />
                          <Link href={`/print/${tx.id}`} aria-label="Ø·Ø¨Ø§Ø¹Ø© Ø§Ù„Ù…Ø³ØªÙ†Ø¯" title="Ø·Ø¨Ø§Ø¹Ø© Ø§Ù„Ù…Ø³ØªÙ†Ø¯" className="text-muted-foreground hover:text-primary">
                            <Printer className="h-3.5 w-3.5" />
                          </Link>
                        </span>
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {formatDateTime(tx.createdAt)}
                      </TableCell>
                      <TableCell>{typeBadge(tx.type)}</TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium text-sm">{itemName || 'â€”'}</div>
                          <div className="text-xs text-muted-foreground">
                            {tx.itemType === 'equipment' ? 'ØªØ¬Ù‡ÙŠØ²' : 'Ù…Ø§Ø¯Ø©'}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        {tx.quantity != null ? (
                          <span className="font-semibold tabular-nums">
                            {tx.quantity}
                            {tx.itemUnit ? (
                              <span className="font-normal text-muted-foreground text-xs mr-1">
                                {tx.itemUnit}
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">â€”</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {tx.recipientName || 'â€”'}
                        {tx.recipientPerson && (
                          <div className="text-xs text-muted-foreground">
                            {tx.recipientPerson}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {tx.createdByName || 'â€”'}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            window.open(`/print/${tx.id}`, '_blank');
                          }}
                          title="Ø·Ø¨Ø§Ø¹Ø© / Ø¹Ø±Ø¶ Ø§Ù„Ø³Ù†Ø¯"
                          className="h-8 w-8"
                        >
                          <Printer className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {data && data.total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-3 border-t text-sm">
            <span className="text-muted-foreground">
              Ø¥Ø¬Ù…Ø§Ù„ÙŠ <strong>{data.total}</strong> Ø¹Ù…Ù„ÙŠØ© â€” ØµÙØ­Ø©{' '}
              <strong>{page}</strong> Ù…Ù† <strong>{totalPages}</strong>
            </span>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

