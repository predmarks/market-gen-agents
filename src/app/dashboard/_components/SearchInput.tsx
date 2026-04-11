'use client';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchInput({ value, onChange, placeholder = 'Buscar...' }: SearchInputProps) {
  return (
    <div className="relative max-w-sm">
      <Input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {value && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => onChange('')}
          className="absolute right-1 top-1/2 -translate-y-1/2"
        >
          <X className="size-3" />
        </Button>
      )}
    </div>
  );
}
