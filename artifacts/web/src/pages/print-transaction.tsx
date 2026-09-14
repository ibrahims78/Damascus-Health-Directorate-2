import { useRoute, useLocation } from 'wouter';
import { useGetTransactionPrint } from '@workspace/api-client-react';
import { Printer, ArrowRight, FileDown, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/utils';
import logoUrl from '@assets/damascus-health-directorate-logo.png';
import { Capacitor } from '@capacitor/core';
import { nativeFileActions } from '@/lib/native-file-actions';

export function PrintTransactionPage() {
  const [, params] = useRoute('/print/:id');
  const [, setLocation] = useLocation();
  const id = params?.id ? parseInt(params.id) : 0;

  const { data, isLoading, isError, refetch } = useGetTransactionPrint(id);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-100">
        <div className="flex flex-col items-center gap-3 text-gray-500">
          <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
          <span>جاري تحميل السند...</span>
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex flex-col h-screen items-center justify-center gap-4 bg-gray-100">
        <p className="text-red-600 text-lg font-medium">لم يتم العثور على السند</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => void refetch()} variant="outline">
            <RefreshCw className="ml-2 h-4 w-4" />
            إعادة المحاولة
          </Button>
          <Button onClick={() => setLocation('/transactions')} variant="outline">
            <ArrowRight className="ml-2 h-4 w-4" />
            العودة لسجل العمليات
          </Button>
        </div>
      </div>
    );
  }

  const { transaction: tx, organizationName, printedAt } = data;
  const isIn = tx.type === 'in';
  const isOut = tx.type === 'out';
  const isCustodyOut = tx.type === 'custody_out';
  const isCustodyReturn = tx.type === 'custody_return';
  const isDamage = tx.type === 'damage';
  const isCentralReturn = tx.type === 'central_return';
  const isAdjustment = tx.type === 'adjust';
  const isOperationalOut = isOut || isCustodyOut || isDamage || isCentralReturn;

  const typeMeta: Record<string, { label: string; color: string }> = {
    in: { label: 'سند إدخال', color: '#16a34a' },
    out: { label: 'سند إخراج', color: '#dc2626' },
    init: { label: 'رصيد افتتاحي', color: '#6b7280' },
    adjust: { label: 'سند تسوية', color: '#7c3aed' },
    custody_out: { label: 'سند عهدة', color: '#2563eb' },
    custody_return: { label: 'سند إعادة عهدة', color: '#0891b2' },
    damage: { label: 'سند إتلاف', color: '#ea580c' },
    central_return: { label: 'سند مرتجع مركزي', color: '#9333ea' },
  };
  const { label: typeLabel, color: typeColor } = typeMeta[tx.type] ?? typeMeta.adjust;
  const itemName  = tx.itemType === 'equipment' ? tx.equipmentName : tx.itemName;
  const itemUnit  = tx.itemUnit;

  const handlePdf = async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        await nativeFileActions.print({
          title: `سند ${tx.documentNumber ?? ''}`.trim(),
        });
        return;
      } catch (error) {
        console.error('Native transaction print failed:', error);
      }
    }

    window.focus();
    window.print();
  };

  return (
    <div dir="rtl" style={{ fontFamily: "'Cairo', sans-serif" }} className="print-document min-h-screen bg-gray-100 print:bg-white">

      {/* ─── Toolbar (hidden on print) ─── */}
      <div className="print-hidden bg-white border-b shadow-sm px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <Button variant="ghost" size="sm" onClick={() => setLocation('/transactions')} className="gap-2">
          <ArrowRight className="h-4 w-4" />
          العودة
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">سند رقم: {tx.documentNumber}</span>
          <Button type="button" variant="outline" onClick={handlePdf} className="gap-2" title="يفتح نافذة الطباعة لاختيار حفظ كـ PDF">
            <FileDown className="h-4 w-4" />
            حفظ كـ PDF
          </Button>
          <Button type="button" onClick={handlePdf} className="gap-2">
            <Printer className="h-4 w-4" />
            طباعة السند
          </Button>
        </div>
      </div>

      {/* ─── A4 Container ─── */}
      <div
        className="print-sheet mx-auto my-8 bg-white shadow-lg print:shadow-none print:my-0"
        style={{ width: '210mm', minHeight: '297mm' }}
      >
        <div style={{ padding: '15mm' }}>

          {/* ===== HEADER ===== */}
          <div style={{ borderBottom: '2.5px solid #1e3a5f', paddingBottom: '12px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>

              {/* Right: Organization info */}
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '10px', color: '#6b7280', marginBottom: '1px' }}>
                  الجمهورية العربية السورية
                </div>
                <div style={{ fontSize: '10px', color: '#6b7280', marginBottom: '3px' }}>
                  وزارة الصحة — مستودعات مديرية صحة دمشق
                </div>
                <div style={{ fontSize: '16px', fontWeight: 800, color: '#1e3a5f' }}>
                  {organizationName}
                </div>
              </div>

              {/* Center: Logo */}
              <div style={{ textAlign: 'center', flex: '0 0 auto' }}>
                <img
                  src={logoUrl}
                  alt="شعار مستودعات مديرية صحة دمشق"
                  style={{ width: '72px', height: '72px', objectFit: 'contain', borderRadius: '50%' }}
                />
              </div>

              {/* Left: Document type badge */}
              <div style={{ textAlign: 'center', minWidth: '110px' }}>
                <div
                  style={{
                    display: 'inline-block',
                    padding: '6px 18px',
                    borderRadius: '6px',
                    border: `2px solid ${typeColor}`,
                    color: typeColor,
                    fontWeight: 800,
                    fontSize: '15px',
                    marginBottom: '6px',
                  }}
                >
                  {typeLabel}
                </div>
                <div style={{ fontSize: '12px', color: '#374151', fontWeight: 700 }}>
                  {tx.documentNumber}
                </div>
                <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
                  {tx.createdAt ? new Date(tx.createdAt).toLocaleDateString('ar-SY') : ''}
                </div>
              </div>
            </div>
          </div>

          {/* ===== TRANSACTION INFO ===== */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px 24px',
              padding: '12px 14px',
              backgroundColor: '#f9fafb',
              borderRadius: '6px',
              marginBottom: '20px',
              border: '1px solid #e5e7eb',
            }}
          >
            <InfoRow label="الصنف / الجهاز" value={itemName ?? '—'} bold />
            <InfoRow label="رقم السند"       value={tx.documentNumber ?? '—'} bold />
            {tx.quantity != null && (
              <InfoRow label="الكمية" value={`${tx.quantity} ${itemUnit ?? ''}`} bold />
            )}
            {isOut && tx.recipientName && (
              <InfoRow label="الجهة المستلمة" value={tx.recipientName} />
            )}
            {isOut && tx.recipientPerson && (
              <InfoRow label="اسم المستلم" value={tx.recipientPerson} />
            )}
            {isOut && tx.exitReason && (
              <InfoRow label="سبب الإخراج" value={tx.exitReason} />
            )}
            {isOut && tx.deliveryDestination && (
              <InfoRow
                label="وجهة التسليم"
                value={
                  tx.deliveryDestination === 'administrative_building'
                    ? 'المبنى الإداري'
                    : 'مرفق صحي'
                }
              />
            )}
            {isOut && tx.internalDeliveryNoteNumber && (
              <InfoRow label="رقم مذكرة التسليم الداخلية" value={tx.internalDeliveryNoteNumber} />
            )}
            {isOut && tx.internalDeliveryNoteDate && (
              <InfoRow label="تاريخ مذكرة التسليم الداخلية" value={tx.internalDeliveryNoteDate.substring(0, 10)} />
            )}
            {(isIn || (!isOperationalOut && !isCustodyReturn)) && tx.supplier && (
              <InfoRow label="المورد" value={tx.supplier} />
            )}
            {isIn && tx.deliveryNoteNumber && (
              <InfoRow label="رقم مذكرة التسليم" value={tx.deliveryNoteNumber} />
            )}
            {isIn && tx.deliveryNoteDate && (
              <InfoRow label="تاريخ مذكرة التسليم" value={tx.deliveryNoteDate.substring(0, 10)} />
            )}
            {isIn && tx.supplySource && (
              <InfoRow label="جهة التوريد" value="المستودعات المركزية" />
            )}
            {isIn && tx.documentDate && (
              <InfoRow label="تاريخ الوثيقة" value={tx.documentDate.substring(0, 10)} />
            )}
            {isCustodyOut && tx.custodyHolderName && (
              <InfoRow label="صاحب العهدة" value={tx.custodyHolderName} />
            )}
            {isCustodyOut && tx.custodyNoteNumber && (
              <InfoRow label="رقم سند العهدة" value={tx.custodyNoteNumber} />
            )}
            {isCustodyOut && tx.custodyDate && (
              <InfoRow label="تاريخ العهدة" value={tx.custodyDate.substring(0, 10)} />
            )}
            {isCustodyOut && tx.custodyLocation && (
              <InfoRow label="مكان العهدة" value={tx.custodyLocation} />
            )}
            {(isCustodyReturn || isDamage || isCentralReturn) && tx.returnCondition && (
              <InfoRow label="حالة الإعادة" value={returnConditionLabel(tx.returnCondition)} />
            )}
            {(isCustodyReturn || isDamage || isCentralReturn || isAdjustment) && tx.reason && (
              <InfoRow label="رقم المحضر" value={tx.reason} />
            )}
            {isAdjustment && tx.notes && (
              <InfoRow label="تفاصيل التسوية" value={tx.notes} />
            )}
            {isCustodyReturn && tx.custodyLocation && (
              <InfoRow label="مكان الإرجاع" value={tx.custodyLocation} />
            )}
            {(isCustodyReturn || isDamage || isCentralReturn) && tx.documentDate && (
              <InfoRow
                label={isCustodyReturn ? 'تاريخ الإعادة' : isDamage ? 'تاريخ التلف' : 'تاريخ المرتجع'}
                value={tx.documentDate.substring(0, 10)}
              />
            )}
            {tx.batchNumber && (
              <InfoRow label="رقم الدفعة / اللوت" value={tx.batchNumber} />
            )}
            {tx.expiryDate && (
              <InfoRow label="تاريخ انتهاء الصلاحية" value={tx.expiryDate.substring(0, 10)} />
            )}
          </div>

          {/* ===== ADJUSTMENT DETAILS (structured snapshot) ===== */}
          {isAdjustment && tx.details && (
            <AdjustmentDetailsBlock details={tx.details} itemName={itemName} />
          )}

          {/* ===== ITEMS TABLE ===== */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '28px' }}>
            <thead>
              <tr>
                <th style={thStyle('center', '40px')}>م</th>
                <th style={thStyle('right')}>المادة / الجهاز</th>
                <th style={thStyle('center', '90px')}>النوع</th>
                {tx.quantity != null && (
                  <>
                    <th style={thStyle('center', '70px')}>الوحدة</th>
                    <th style={thStyle('center', '70px')}>الكمية</th>
                  </>
                )}
                <th style={thStyle('right')}>ملاحظات</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ ...tdStyle('center'), fontWeight: 700 }}>1</td>
                <td style={{ ...tdStyle('right'), fontWeight: 700 }}>{itemName ?? '—'}</td>
                <td style={{ ...tdStyle('center'), fontSize: '12px', color: typeColor, fontWeight: 700 }}>
                  {typeLabel}
                </td>
                {tx.quantity != null && (
                  <>
                    <td style={tdStyle('center')}>{itemUnit || '—'}</td>
                    <td style={{ ...tdStyle('center'), fontSize: '18px', fontWeight: 700, color: typeColor }}>
                      {tx.quantity}
                    </td>
                  </>
                )}
                <td style={{ ...tdStyle('right'), color: '#6b7280', fontSize: '12px' }}>
                  {tx.notes || ''}
                </td>
              </tr>
              {[2, 3, 4].map((n) => (
                <tr key={n}>
                  <td style={{ ...tdStyle('center'), color: '#d1d5db' }}>{n}</td>
                  <td style={tdStyle('right')}>&nbsp;</td>
                  <td style={tdStyle('center')}>&nbsp;</td>
                  {tx.quantity != null && (
                    <>
                      <td style={tdStyle('center')}>&nbsp;</td>
                      <td style={tdStyle('center')}>&nbsp;</td>
                    </>
                  )}
                  <td style={tdStyle('right')}>&nbsp;</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* ===== SIGNATURES ===== */}
          <div
            style={{
              display: 'grid',
               gridTemplateColumns: isOperationalOut || isCustodyReturn ? '1fr 1fr 1fr 1fr' : '1fr 1fr',
              gap: '24px',
              marginTop: '40px',
            }}
          >
            <SignatureBox
              title="أمين المستودع"
            />

            {(isOperationalOut || isCustodyReturn) && <SignatureBox title="المسؤول المرسل" />}
            {(isOperationalOut || isCustodyReturn) && <SignatureBox title="المشرف" />}

            <SignatureBox
              title={isCustodyOut ? 'صاحب العهدة' : isCustodyReturn ? 'المستلم' : isOperationalOut ? 'المستلم / الجهة' : isIn ? 'المورد / المسلِّم' : 'المسؤول'}
              name={isCustodyOut ? tx.custodyHolderName ?? undefined : isOut && tx.recipientPerson ? tx.recipientPerson : undefined}
            />
          </div>

          {/* ===== FOOTER ===== */}
          <div
            style={{
              marginTop: '48px',
              paddingTop: '8px',
              borderTop: '1px solid #e5e7eb',
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '10px',
              color: '#9ca3af',
            }}
          >
            <span>طُبع في: {formatDateTime(printedAt)}</span>
            <span>{organizationName} — {typeLabel} رقم {tx.documentNumber}</span>
          </div>

        </div>
      </div>

      {/* PDF tip (visible on screen only) */}
      <div className="print-hidden text-center text-xs text-gray-400 mb-4">
        لحفظ السند كملف PDF: اضغط "حفظ كـ PDF" ثم اختر "حفظ كـ PDF" من نافذة الطباعة
      </div>
    </div>
  );
}

/* ─── Helper Components ─── */

function InfoRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: '6px', alignItems: 'baseline' }}>
      <span style={{ color: '#6b7280', minWidth: '130px', flexShrink: 0, fontSize: '12px' }}>{label}:</span>
      <span style={{ fontWeight: bold ? 700 : 500, fontSize: '13px' }}>{value}</span>
    </div>
  );
}

function returnConditionLabel(value: string): string {
  return {
    good: 'سليم',
    damaged: 'تالف',
    needs_maintenance: 'بحاجة إلى صيانة',
    missing: 'مفقود',
  }[value] ?? value;
}

function SignatureBox({ title, name }: { title: string; name?: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ height: '50px' }} />
      <div style={{ borderTop: '1.5px solid #374151', paddingTop: '8px' }}>
        <div style={{ fontWeight: 700, fontSize: '13px' }}>{title}</div>
        {name && (
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>{name}</div>
        )}
        <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>التوقيع والختم</div>
      </div>
    </div>
  );
}

/* ─── Structured adjustment snapshot (approved plan §3.1) ─── */

function AdjustmentDetailsBlock({ details, itemName }: { details: unknown; itemName?: string | null }) {
  const d = (details ?? {}) as Record<string, unknown>;
  const delta = typeof d.delta === 'number' ? d.delta : null;
  const deltaType = d.deltaType === 'decrease' ? 'نقص' : 'زيادة';
  const isEquipment = !!(d.openCustody !== undefined || d.equipmentNameSnap);
  const row = (label: string, value: React.ReactNode) => (
    <tr>
      <td style={{ ...tdStyle('right'), backgroundColor: '#f9fafb', fontWeight: 600, width: '220px' }}>
        {label}
      </td>
      <td style={tdStyle('right')}>
        <span style={{ fontWeight: 700 }}>{value}</span>
      </td>
    </tr>
  );

  return (
    <div style={{ marginBottom: '28px' }}>
      <h3 style={{ fontWeight: 800, fontSize: '14px', marginBottom: '10px', color: '#374151' }}>
        تفاصيل التسوية (لقطة موثقة)
      </h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {row('الرصيد قبل الجرد', `${d.previousStock ?? '—'}`)}
          {row('الرصيد بعد الجرد', `${d.newStock ?? '—'}`)}
          {row('الفرق', delta !== null ? (
            <span style={{ color: (d.deltaType ?? '') === 'decrease' ? '#dc2626' : '#16a34a' }}>
              {delta > 0 ? '+' : ''}{delta} ({deltaType})
            </span>
          ) : '—')}
          {isEquipment && row('العهد المفتوحة وقت التسوية', `${d.openCustody ?? 0}`)}
          {isEquipment && row('المتاح في المستودع قبل التسوية', `${d.availableBefore ?? '—'}`)}
          {isEquipment && d.equipmentModelSnap ? row('الموديل', `${d.equipmentModelSnap}`) : null}
          {isEquipment && d.equipmentSerialSnap ? row('الرقم التسلسلي', `${d.equipmentSerialSnap}`) : null}
          {isEquipment && d.equipmentConditionSnap ? row('الحالة وقت التسوية', `${d.equipmentConditionSnap}`) : null}
          {row('المرجع', itemName ?? '—')}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Style Helpers ─── */

function thStyle(align: 'right' | 'center' | 'left', width?: string): React.CSSProperties {
  return {
    border: '1px solid #9ca3af',
    padding: '7px 8px',
    textAlign: align,
    fontWeight: 700,
    width,
    backgroundColor: '#f3f4f6',
  };
}

function tdStyle(align: 'right' | 'center' | 'left'): React.CSSProperties {
  return {
    border: '1px solid #d1d5db',
    padding: '8px',
    textAlign: align,
    verticalAlign: 'middle',
  };
}
