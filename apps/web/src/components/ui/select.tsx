'use client';

import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown } from 'lucide-react';
import { Command } from 'cmdk';
import { useState } from 'react';

export type SelectOption = { value: string; label: string; keywords?: string };

export function Select({ value, options, onChange, placeholder = 'Select an option', searchPlaceholder = 'Search options…', disabled = false, invalid = false, ariaLabel }: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild><button type="button" className={`ui-select-trigger${invalid ? ' ui-invalid' : ''}`} role="combobox" aria-label={ariaLabel} aria-expanded={open} aria-invalid={invalid || undefined} disabled={disabled}>
      <span>{selected?.label ?? placeholder}</span><ChevronDown size={15} aria-hidden="true"/>
    </button></Popover.Trigger>
    <Popover.Portal><Popover.Content className="ui-select-popover" align="start" sideOffset={5} onOpenAutoFocus={(event) => event.preventDefault()}>
      <Command className="ui-command">
        <Command.Input placeholder={searchPlaceholder} className="ui-command-input" aria-label={searchPlaceholder}/>
        <Command.List className="ui-command-list">
          <Command.Empty className="ui-command-status">No matching options.</Command.Empty>
          <Command.Group>{options.map((option) => <Command.Item key={option.value} value={`${option.label} ${option.keywords ?? ''}`} onSelect={() => { onChange(option.value); setOpen(false); }} className="ui-command-item">
            <Check size={15} aria-hidden="true" className={option.value === value ? 'ui-command-check selected' : 'ui-command-check'}/>{option.label}
          </Command.Item>)}</Command.Group>
        </Command.List>
      </Command>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
