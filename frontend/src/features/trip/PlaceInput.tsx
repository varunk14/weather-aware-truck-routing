import { type KeyboardEvent, useEffect, useId, useState } from "react";

import { PHONE_QUERY } from "../../hooks/useMediaQuery";
import { isAbortError, suggestPlaces } from "../../lib/api";
import type { Suggestion } from "../../lib/types";
import styles from "./fields.module.css";
import type { PlaceValue } from "./tripDraft";

export const SUGGEST_DELAY_MS = 250;
// About how long a phone's on-screen keyboard takes to open.
export const KEYBOARD_OPEN_MS = 300;
const MIN_CHARS = 2;

/**
 * Suggestions for ``query``, fetched after a short pause in typing. A newer query cancels the
 * request for an older one, and only suggestions for the text as it is now are returned, so an
 * old list can never be picked for new text.
 */
function useSuggestions(query: string): Suggestion[] {
  const [found, setFound] = useState<{ query: string; results: Suggestion[] }>({
    query: "",
    results: [],
  });
  const trimmed = query.trim();
  const active = trimmed.length >= MIN_CHARS;

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      suggestPlaces(trimmed, controller.signal).then(
        (results) => {
          setFound({ query: trimmed, results });
        },
        (error: unknown) => {
          // Suggestions only help; if they fail, typing a place by name still works.
          if (!isAbortError(error)) setFound({ query: trimmed, results: [] });
        },
      );
    }, SUGGEST_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, active]);

  return active && found.query === trimmed ? found.results : [];
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
        // Enter that confirms an input method's composition (for example Japanese) is not a pick.
        if (event.nativeEvent.isComposing) break;
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
        onFocus={(event) => {
          // On a phone the keyboard covers the lower half of the screen: once it is open, bring
          // the field to the top of the panel so the suggestions under it are in view.
          const field = event.currentTarget.parentElement;
          if (!field || !window.matchMedia(PHONE_QUERY).matches) return;
          const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          window.setTimeout(() => {
            field.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
          }, KEYBOARD_OPEN_MS);
        }}
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
