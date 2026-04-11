'use client';

import { useState } from 'react';
import { strip } from '@/lib/strip-diacritics';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { X, Filter } from 'lucide-react';

export interface FilterGroup {
  key: string;
  label: string;
  options: { value: string; label: string; count: number }[];
}

export interface ActiveFilter {
  group: string;
  value: string;
  label: string;
}

interface FilterComboboxProps {
  groups: FilterGroup[];
  active: ActiveFilter[];
  onSelect: (group: string, value: string) => void;
  onRemove: (group: string) => void;
  placeholder?: string;
}

export function FilterCombobox({ groups, active, onSelect, onRemove, placeholder = 'Filtrar...' }: FilterComboboxProps) {
  const [open, setOpen] = useState(false);

  function handleSelect(group: string, value: string) {
    onSelect(group, value);
    setOpen(false);
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {active.map(a => (
        <Badge key={a.group} variant="default" className="gap-1">
          {a.label}
          <button
            onClick={() => onRemove(a.group)}
            className="hover:text-primary-foreground/70 cursor-pointer"
            aria-label={`Quitar filtro ${a.label}`}
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={<Button variant="outline" size="sm" className="gap-1.5" />}
        >
          <Filter className="size-3.5" />
          {active.length > 0 ? 'Agregar filtro' : placeholder}
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          <Command
            filter={(value, search) => {
              const stripped = strip(search);
              return strip(value).includes(stripped) ? 1 : 0;
            }}
          >
            <CommandInput placeholder="Buscar filtro..." />
            <CommandList>
              <CommandEmpty>Sin resultados.</CommandEmpty>
              {groups.map(g => {
                if (g.options.length === 0) return null;
                return (
                  <CommandGroup key={g.key} heading={g.label}>
                    {g.options.map(o => {
                      const isActive = active.some(a => a.group === g.key && a.value === o.value);
                      return (
                        <CommandItem
                          key={`${g.key}-${o.value}`}
                          value={o.label}
                          onSelect={() => handleSelect(g.key, o.value)}
                          className={isActive ? 'font-medium' : ''}
                        >
                          <span className="flex-1">{o.label}</span>
                          <span className="text-xs text-muted-foreground">{o.count.toLocaleString()}</span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                );
              })}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
