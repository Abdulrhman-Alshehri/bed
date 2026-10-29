import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { getCountry, searchCountries } from '../data/countries';

interface Props {
  id: string;
  value: string;
  onChange: (code: string) => void;
  aria: { 'aria-describedby'?: string; 'aria-invalid'?: boolean; 'aria-required'?: boolean };
}

/** Searchable nationality list (WAI-ARIA 1.2 combobox with a listbox popup). */
export function NationalityCombobox({ id, value, onChange, aria }: Props) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = `${id}-list`;
  const selected = getCountry(value);
  const results = useMemo(() => searchCountries(editing ? query : ''), [editing, query]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(`${id}-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, id]);

  const close = () => {
    setOpen(false);
    setEditing(false);
    setQuery('');
  };

  const choose = (code: string) => {
    onChange(code);
    close();
  };

  const openList = () => {
    const index = Math.max(0, results.findIndex((c) => c.code === value));
    setActive(editing ? 0 : index);
    setOpen(true);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return openList();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => Math.min(results.length - 1, Math.max(0, a + delta)));
    } else if (e.key === 'Enter') {
      if (open && results[active]) {
        e.preventDefault();
        choose(results[active].code);
      }
    } else if (e.key === 'Escape') {
      if (open || editing) {
        e.preventDefault();
        close();
      }
    } else if (e.key === 'Home' && open) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End' && open) {
      e.preventDefault();
      setActive(results.length - 1);
    }
  };

  return (
    <div className="combobox">
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && results[active] ? `${id}-opt-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder="ابحث بالاسم العربي أو الإنجليزي"
        value={editing ? query : (selected?.ar ?? '')}
        onChange={(e) => {
          setEditing(true);
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        onBlur={close}
        {...aria}
      />
      <div className="combobox-buttons">
        {value && (
          <button
            type="button"
            className="btn-icon"
            aria-label="مسح الجنسية"
            onClick={() => {
              onChange('');
              inputRef.current?.focus();
            }}
          >
            <X aria-hidden="true" size={16} />
          </button>
        )}
        <button
          type="button"
          className="btn-icon"
          tabIndex={-1}
          aria-label="عرض قائمة الجنسيات"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            inputRef.current?.focus();
            if (open) close();
            else openList();
          }}
        >
          <ChevronDown aria-hidden="true" size={18} />
        </button>
      </div>
      <ul id={listId} role="listbox" aria-label="الجنسيات" className="combobox-list" hidden={!open}>
        {open && results.length === 0 && <li className="combobox-empty">لا توجد نتائج</li>}
        {open &&
          results.map((c, i) => (
            <li
              key={c.code}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className={`combobox-option${c.code === value ? ' is-selected' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(c.code)}
            >
              <span>{c.ar}</span>
              <span className="combobox-option-en" dir="ltr">
                {c.en}
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}
