import { type KeyboardEvent, useEffect, useId, useState } from "react";

import { isAbortError, suggestPlaces } from "../../lib/api";
import type { Suggestion } from "../../lib/types";
import styles from "./fields.module.css";
import type { PlaceValue } from "./tripDraft";

export const SUGGEST_DELAY_MS = 250;
const MIN_CHARS = 2;

/**
 * Suggestions for ``query``, fetched after a short pause in typing. A newer query cancels the
 * request for an older one. The last results stay visible while the next ones load.
 */
function useSuggestions(query: string): Suggestion[] {
  const [found, setFound] = useState<Suggestion[]>([]);
  const trimmed = query.trim();
  const active = trimmed.length >= MIN_CHARS;

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      suggestPlaces(trimmed, controller.signal).then(setFound, (error: unknown) => {
        // Suggestions only help; if they fail, typing a place by name still works.
        if (!isAbortError(error)) setFound([]);
      });
    }, SUGGEST_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, active]);

  return active ? found : [];
}

interface PlaceInputProps {
  label: string;
  value: PlaceValue;
  onChange: (value: PlaceValue) => void;
  error?: string;
  placeholder?: string;
}

/** A text field with place suggestions, following the ARIA combobox pattern. */
export function PlaceInput({ label, value, onChange, error, placeholder }: PlaceInputProps) {
  const id = useId();
  const listId = `${id}-suggestions`;
  const errorId = `${id}-error`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const suggestions = useSuggestions(open && !value.picked ? value.text : "");
  const expanded = open && suggestions.length > 0;
  const optionId = (index: number) => `${id}-option-${String(index)}`;

  function pick(suggestion: Suggestion) {
    onChange({ text: suggestion.title, picked: { id: suggestion.id, type: suggestion.type } });
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const count = suggestions.length;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setOpen(true);
        if (count) setActive((index) => (index + 1) % count);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (count) setActive((index) => (index <= 0 ? count - 1 : index - 1));
        break;
      case "Enter": {
        const suggestion = expanded ? suggestions[active] : undefined;
        if (suggestion) {
          event.preventDefault();
          pick(suggestion);
        }
        break;
      }
      case "Escape":
        if (expanded) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          setActive(-1);
        }
        break;
    }
  }

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={styles.input}
        type="text"
        role="combobox"
        autoComplete="off"
        autoCapitalize="words"
        spellCheck={false}
        placeholder={placeholder}
        value={value.text}
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          onChange({ text: event.target.value });
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          setOpen(false);
          setActive(-1);
        }}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label={`${label} suggestions`}
        className={styles.list}
        hidden={!expanded}
      >
        {suggestions.map((suggestion, index) => (
          <li
            key={`${suggestion.type}:${suggestion.id}`}
            id={optionId(index)}
            role="option"
            aria-selected={index === active}
            className={styles.option}
            // Keep focus in the input, so the list does not close before the click lands.
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              pick(suggestion);
            }}
          >
            <span className={styles.title}>{suggestion.title}</span>
            {suggestion.subtitle && <span className={styles.subtitle}>{suggestion.subtitle}</span>}
          </li>
        ))}
      </ul>
      {error && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
