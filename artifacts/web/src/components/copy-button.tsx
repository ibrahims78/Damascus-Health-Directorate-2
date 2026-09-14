import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function CopyButton({
  value,
  label,
  className,
}: {
  value: string | null | undefined;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const canCopy = Boolean(value?.trim());

  const handleCopy = async () => {
    if (!value?.trim()) {
      toast.error(`لا يوجد ${label} لنسخه`);
      return;
    }

    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(`تم نسخ ${label} بنجاح`);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error(`تعذر نسخ ${label}. تحقق من صلاحية الحافظة ثم حاول مرة أخرى`);
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={className}
          aria-label={`نسخ ${label}`}
          onClick={() => void handleCopy()}
          disabled={!canCopy}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copied ? 'تم النسخ' : `نسخ ${label}`}</TooltipContent>
    </Tooltip>
  );
}