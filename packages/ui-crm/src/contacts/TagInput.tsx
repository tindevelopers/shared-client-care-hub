import { useState, type KeyboardEvent } from "react";

export interface TagInputProps {
  value: string[];
  onChange(value: string[]): void;
  label?: string;
  disabled?: boolean;
}

export function TagInput({
  value,
  onChange,
  label = "Tags",
  disabled = false,
}: TagInputProps) {
  const [draft, setDraft] = useState("");

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      const tag = draft.trim();
      if (tag && !value.includes(tag)) onChange([...value, tag]);
      setDraft("");
    } else if (event.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div>
      <label>
        {label}
        <input
          aria-label={label}
          disabled={disabled}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </label>
      {value.length > 0 && (
        <ul aria-label={`${label} selected`}>
          {value.map((tag) => (
            <li key={tag}>
              {tag}{" "}
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove ${tag}`}
                onClick={() => onChange(value.filter((item) => item !== tag))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
