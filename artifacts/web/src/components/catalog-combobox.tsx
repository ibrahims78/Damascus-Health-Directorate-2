import type { ReactNode } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type CatalogOption = {
  value: string;
  searchValue: string;
  label: ReactNode;
};

type CatalogComboboxProps = {
  value: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onValueChange: (value: string) => void;
  options: CatalogOption[];
  placeholder: string;
  searchPlaceholder: string;
  emptyMessage: string;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
};

/**
 * Searchable picker for inventory catalogs.
 *
 * The list owns its scroll container instead of relying on the browser's
 * native select popup. This keeps long Arabic labels usable on desktop and
 * mobile and makes the keyboard navigation consistent across all forms.
 */
export function CatalogCombobox({
  value,
  open,
  onOpenChange,
  onValueChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  loading = false,
  disabled = false,
  className,
}: CatalogComboboxProps) {
  const selectedOption = options.find((option) => option.value === value);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('w-full justify-between gap-3 font-normal', className)}
        >
          <span
            className={cn(
              'min-w-0 truncate text-right',
              !selectedOption && 'text-muted-foreground',
            )}
          >
            {selectedOption?.label ?? placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-1rem)] overflow-hidden p-0"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList className="min-h-0 max-h-[min(60vh,28rem)] overflow-y-auto overscroll-contain">
            <CommandEmpty>{loading ? 'جاري تحميل الخيارات...' : emptyMessage}</CommandEmpty>
            <CommandGroup className="overflow-visible">
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.searchValue}
                  onSelect={() => {
                    onValueChange(option.value);
                    onOpenChange(false);
                  }}
                  className="items-start py-2.5 pr-8"
                >
                  <Check
                    className={cn(
                      'mt-0.5 h-4 w-4 shrink-0',
                      value === option.value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span className="min-w-0 flex-1 whitespace-normal break-words text-right">
                    {option.label}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}