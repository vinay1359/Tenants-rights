'use client';

import { JURISDICTION_SUGGESTIONS } from '@/lib/jurisdictions';

const LIST_ID = 'trc-jurisdiction-suggestions';

type Props = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

export function JurisdictionField({ id, value, onChange, placeholder }: Props) {
  return (
    <>
      <input
        id={id}
        type="text"
        className="input-text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        list={LIST_ID}
        autoComplete="off"
      />
      <datalist id={LIST_ID}>
        {JURISDICTION_SUGGESTIONS.map((j) => (
          <option key={j} value={j} />
        ))}
      </datalist>
    </>
  );
}
