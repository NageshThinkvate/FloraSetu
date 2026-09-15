import { useId, useMemo, useRef, useState } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

interface SearchableSelectProps {
  label: string;
  options: SelectOption[];
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  testId?: string;
}

export function SearchableSelect({
  label,
  options,
  value,
  onChange,
  placeholder = 'Search…',
  testId = 'searchable-select'
}: SearchableSelectProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return options;
    }
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q)
    );
  }, [options, query]);

  const choose = (opt: SelectOption): void => {
    onChange(opt.value);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && open && filtered[activeIndex]) {
      e.preventDefault();
      choose(filtered[activeIndex]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div
      className="fs-field fs-combo"
      ref={rootRef}
      data-testid={testId}
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node)) {
          setOpen(false);
        }
      }}
    >
      <label className="fs-field__label" htmlFor={`${testId}-input`}>
        {label}
      </label>
      <input
        id={`${testId}-input`}
        data-testid={`${testId}-input`}
        className="fs-input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && filtered[activeIndex] ? `${testId}-opt-${filtered[activeIndex].value}` : undefined}
        aria-autocomplete="list"
        placeholder={selected ? selected.label : placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {selected && !query && (
        <span className="fs-caption fs-text-secondary" data-testid={`${testId}-value`}>
          Selected: {selected.label}
        </span>
      )}
      {open && (
        <ul className="fs-combo__list" id={listId} role="listbox" aria-label={label} data-testid={`${testId}-list`}>
          {filtered.length === 0 && <li className="fs-combo__empty">No matches — try a different search.</li>}
          {filtered.map((opt, i) => (
            <li
              key={opt.value}
              id={`${testId}-opt-${opt.value}`}
              role="option"
              aria-selected={opt.value === value}
              className={`fs-combo__option${i === activeIndex ? ' fs-combo__option--active' : ''}`}
              data-testid={`${testId}-option-${opt.value}`}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(opt);
              }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <span>{opt.label}</span>
              {opt.hint && <span className="fs-combo__hint">{opt.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
