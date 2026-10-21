'use client';

import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown } from 'lucide-react';
import { Command } from 'cmdk';
import { Children, isValidElement, useId, useState, type ReactNode } from 'react';

type OptionProps = { value?: string | number; children?: ReactNode; disabled?: boolean };

/** Native-select-compatible API backed by the app's shared, keyboard-friendly popover. */
export function DropdownSelect({ value, onChange, children, className = '', required = false, disabled = false, 'aria-label': ariaLabel }: {
  value: string | number;
  onChange: (event: { target: { value: string } }) => void;
  children: ReactNode;
  className?: string;
  required?: boolean;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  const [open, setOpen] = useState(false);
  const proxyId = useId();
  const options = Children.toArray(children).filter((child): child is React.ReactElement<OptionProps> => isValidElement<OptionProps>(child) && child.type === 'option').map((child) => ({
    value: String(child.props.value ?? child.props.children ?? ''),
    label: String(child.props.children ?? ''),
    disabled: child.props.disabled ?? false,
  }));
  const selected = options.find((option) => option.value === String(value));

  return <span className="ui-select-wrap">
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild><button id={proxyId} type="button" className={`ui-select-trigger ${className}`.trim()} role="combobox" aria-label={ariaLabel} aria-expanded={open} disabled={disabled}>
        <span>{selected?.label ?? options.find((option) => option.value === '')?.label ?? 'Select an option'}</span><ChevronDown size={15} aria-hidden="true"/>
      </button></Popover.Trigger>
      <Popover.Portal><Popover.Content className="ui-select-popover" align="start" sideOffset={5} onOpenAutoFocus={(event) => event.preventDefault()}>
        <Command className="ui-command">
          <Command.Input placeholder="Search options…" className="ui-command-input" aria-label="Search options" />
          <Command.List className="ui-command-list">
            <Command.Empty className="ui-command-status">No matching options.</Command.Empty>
            <Command.Group>{options.filter((option) => !option.disabled).map((option) => <Command.Item key={option.value} value={option.label} onSelect={() => { onChange({ target: { value: option.value } }); setOpen(false); }} className="ui-command-item">
              <Check size={15} aria-hidden="true" className={option.value === String(value) ? 'ui-command-check selected' : 'ui-command-check'}/>{option.label}
            </Command.Item>)}</Command.Group>
          </Command.List>
        </Command>
      </Popover.Content></Popover.Portal>
    </Popover.Root>
    {required && <input className="ui-select-required-proxy" tabIndex={-1} aria-hidden="true" value={String(value)} required onChange={() => undefined} onInvalid={(event) => { event.preventDefault(); setOpen(true); document.getElementById(proxyId)?.focus(); }} />}
  </span>;
}
